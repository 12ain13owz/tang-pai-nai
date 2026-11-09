import { DOCUMENT, Injectable, computed, effect, inject, signal, untracked } from '@angular/core'
import { TranslocoService } from '@jsverse/transloco'
import { toast } from '@spartan-ng/brain/sonner'
import { ApiClient, isUnreachable, toApiError } from '@/core/api'
import { AuthStore } from '@/core/auth'
import { NetworkStatusService } from '@/core/network'
import { deleteOp, listOps, OfflineService, putRow, SyncService } from '@/core/offline'
import type { LocalDatabase, SyncRow } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import type { Profile } from '@/core/profile'
import { TransactionService } from '@/core/transaction'
import type {
  OwnerSharing,
  ShareRole,
  ShareGroup,
  SharedProfileRows,
  SharedWithMe,
  SharingInvite,
} from './sharing.type'

/** Codes the API answers with (sharing.md → Endpoints); anything else is a generic failure. */
const KNOWN_CODES = new Set([
  'SHARE_SELF',
  'SHARE_ALREADY_MEMBER',
  'SHARE_INVITE_PENDING',
  'SHARE_MEMBER_LIMIT',
  'SHARE_WALLETS_INVALID',
  'SHARE_INVITE_EMPTY',
  'SHARE_DAILY_LIMIT',
  'SHARE_RESEND_COOLDOWN',
  'RATE_LIMITED',
])

/**
 * Family sharing (docs/features/sharing.md): every call is online REST, and what it reads stays
 * in memory only (offline-sync rule 15), cleared when the signed-in user changes. The shell loads
 * this service with a dynamic `import()` after its first render, so it stays out of the initial
 * bundle; pages inject it directly.
 */
/** Rows per read of a shared profile, like a pull page. */
const ROWS_PAGE = 5000
/** How often a shared profile in use reads what changed (others' writes). */
const REFRESH_MS = 60_000

@Injectable({ providedIn: 'root' })
export class SharingService {
  private api = inject(ApiClient)
  private authStore = inject(AuthStore)
  private network = inject(NetworkStatusService)
  private offlineService = inject(OfflineService)
  private syncService = inject(SyncService)
  private profileService = inject(ProfileService)
  private transactionService = inject(TransactionService)
  private transloco = inject(TranslocoService)
  private window = inject(DOCUMENT).defaultView

  /** Invites to me and wallets shared with me; `null` until read once. */
  withMe = signal<SharedWithMe | null>(null)
  /** The owner's view per profile id. */
  private owners = signal<ReadonlyMap<string, OwnerSharing>>(new Map())
  /** The shared profile in use: its id and the last `changeSeq` read (sharing rule 9). */
  private session: { profileId: string; cursor: number; walletIds: Set<string> } | null = null
  private pushing: Promise<void> | null = null
  /** When the data on screen was read (the offline notice says it). */
  readAt = signal<number | null>(null)

  canCall = computed(() => this.network.isOnline() && this.network.serverReachable())
  inviteCount = computed(() => this.withMe()?.invites.length ?? 0)

  constructor() {
    let userId: string | null = null
    effect(() => {
      const id = this.authStore.user()?.id ?? null
      const online = this.canCall()
      untracked(() => {
        if (id !== userId) {
          userId = id
          this.clear()
        }
        if (id && online && !this.withMe()) {
          void this.loadWithMe().catch(() => undefined)
        }
      })
    })
    // An editor's write lands in the TEMP outbox: push it at once (sharing rule 11).
    effect(() => {
      this.offlineService.changes()
      if (this.offlineService.sharedActive() && this.canCall()) {
        untracked(() => void this.pushShared())
      }
    })
    // Back online with a shared profile in use: read what changed meanwhile.
    effect(() => {
      if (this.canCall() && this.offlineService.sharedActive()) {
        untracked(() => void this.refreshShared())
      }
    })
    this.window?.setInterval(() => void this.refreshShared(), REFRESH_MS)
    this.window?.document.addEventListener('visibilitychange', () => {
      if (this.window?.document.visibilityState === 'visible') {
        void this.refreshShared()
      }
    })
  }

  // ---------- A shared profile in use (sharing rules 9–15) ----------

  /** Switches to a profile shared with me: its rows go into the TEMP tables. */
  async openShared(group: ShareGroup): Promise<void> {
    const profile: Profile = {
      ...group.profile,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
      deletedAt: null,
      changeSeq: null,
    }
    this.profileService.leaveShared()
    this.profileService.shared.set({
      profile,
      role: group.role,
      owner: { id: group.owner.id, displayName: group.owner.displayName },
      status: 'loading',
    })
    try {
      // Read the rows while a running own sync round ends: the TEMP tables wait for it.
      const [pages] = await Promise.all([this.fetchRows(profile.id, 0), this.syncService.idle()])
      if (this.profileService.shared()?.profile.id !== profile.id) {
        return // another profile was picked meanwhile
      }
      this.offlineService.enterShared()
      this.session = { profileId: profile.id, cursor: 0, walletIds: new Set() }
      this.putPages(pages)
      const shared = this.profileService.shared()
      if (shared?.profile.id === profile.id) {
        this.profileService.shared.set({ ...shared, status: 'ready' })
      }
    } catch (error) {
      this.endShared()
      toast.error(this.transloco.translate(this.failure(error)))
    }
  }

  /** Reads what changed in the shared profile in use (others' writes, a removal). */
  async refreshShared(): Promise<void> {
    const session = this.session
    if (!session || !this.offlineService.sharedActive() || !this.canCall()) {
      return
    }
    try {
      await this.readRows(session.profileId)
    } catch (error) {
      if (toApiError(error).status === 404) {
        this.removedFromShared()
      }
    }
  }

  private async readRows(profileId: string): Promise<void> {
    const pages = await this.fetchRows(profileId, this.session?.cursor ?? 0)
    if (this.session?.profileId === profileId && this.offlineService.sharedActive()) {
      this.putPages(pages)
    }
  }

  /** Every page from `since` on (sharing rule 9). */
  private async fetchRows(profileId: string, since: number): Promise<SharedProfileRows[]> {
    const pages: SharedProfileRows[] = []
    let cursor = since
    for (;;) {
      const data = (
        await this.api.get<SharedProfileRows>(
          `/sharing/with-me/${profileId}/rows?since=${cursor}&limit=${ROWS_PAGE}`
        )
      ).data as SharedProfileRows
      pages.push(data)
      cursor = data.cursor
      if (!data.hasMore) {
        return pages
      }
    }
  }

  private putPages(pages: readonly SharedProfileRows[]): void {
    for (const data of pages) {
      this.putRows(data)
      if (this.session) {
        this.session.cursor = data.cursor
      }
    }
  }

  /** Wallets and categories are read whole each time; transactions by `changeSeq`. */
  private putRows(data: SharedProfileRows): void {
    const walletIds = new Set(data.wallets.map((row) => String(row['id'])))
    this.offlineService.fillShared((db) => {
      db.exec('DELETE FROM wallets')
      db.exec('DELETE FROM categories')
      for (const row of data.wallets) {
        putRow(db, 'wallets', row)
      }
      for (const row of data.categories) {
        putRow(db, 'categories', row)
      }
      const { columns, rows } = data.transactions
      for (const values of rows) {
        const row: SyncRow = Object.fromEntries<unknown>(
          columns.map((column, i) => [column, values[i]])
        )
        // A pending write of mine stays until its push answers (offline-sync rule 9).
        if (!hasPending(db, String(row['id']))) {
          putRow(db, 'transactions', row)
        }
      }
      // A wallet no longer shared takes its rows with it.
      if (this.session) {
        for (const id of this.session.walletIds) {
          if (!walletIds.has(id)) {
            db.exec('DELETE FROM transactions WHERE wallet_id = ?', [id])
          }
        }
        this.session.walletIds = walletIds
      }
    })
    this.transactionService.addPeople(data.people)
    const shared = this.profileService.shared()
    if (shared) {
      this.profileService.shared.set({
        ...shared,
        role: data.role,
        profile: { ...shared.profile, ...data.profile },
      })
    }
  }

  /** Pushes the TEMP outbox and settles what the server refused (sharing rules 13, 16). */
  private async pushShared(): Promise<void> {
    if (this.pushing || !hasOps(this.offlineService)) {
      return
    }
    this.pushing = this.syncService
      .pushShared()
      .then(async () => this.settleRefused())
      .catch(() => undefined)
      .finally(() => {
        this.pushing = null
      })
    await this.pushing
  }

  private async settleRefused(): Promise<void> {
    if (!this.offlineService.sharedActive()) {
      return
    }
    const refused = listOps(this.offlineService.db(), 'rejected')
    if (refused.length === 0) {
      return
    }
    // The rows already went back to the server's versions (or away, for a refused add).
    this.offlineService.fillShared((db) => {
      for (const op of refused) {
        deleteOp(db, op.opId)
      }
    })
    if (refused.some((op) => op.code === 'NOT_SHARED')) {
      this.removedFromShared()
      return
    }
    const stale = refused.some((op) => op.code === 'STALE')
    toast.error(this.transloco.translate(stale ? 'sharing.stale' : 'sharing.refused'))
    await this.refreshShared()
  }

  /** Sharing rule 16: told, then back to an own profile. */
  private removedFromShared(): void {
    toast.error(this.transloco.translate('sharing.removedFromShared'))
    this.endShared()
    void this.loadWithMe().catch(() => undefined)
  }

  private endShared(): void {
    this.session = null
    this.profileService.leaveShared()
  }

  owner(profileId: string): OwnerSharing | null {
    return this.owners().get(profileId) ?? null
  }

  /** The translation key for a failed call. */
  failure(error: unknown): string {
    const apiError = toApiError(error)
    if (isUnreachable(apiError)) {
      return 'sharing.needsOnline'
    }
    return apiError.code && KNOWN_CODES.has(apiError.code)
      ? `sharing.error.${apiError.code}`
      : 'sharing.error.generic'
  }

  async loadWithMe(): Promise<SharedWithMe> {
    const data = (await this.api.get<SharedWithMe>('/sharing/with-me')).data as SharedWithMe
    this.withMe.set(data)
    this.readAt.set(Date.now())
    return data
  }

  async loadOwner(profileId: string): Promise<OwnerSharing> {
    const data = (await this.api.get<OwnerSharing>(`/sharing/profiles/${profileId}`))
      .data as OwnerSharing
    this.owners.update((map) => new Map(map).set(profileId, data))
    // Sharing rule 15: the names behind "เพิ่มโดย …" on the owner's rows.
    this.transactionService.addPeople(
      data.members.map((member) => ({ id: member.userId, displayName: member.displayName }))
    )
    return data
  }

  // ---------- Owner ----------

  async invite(
    profileId: string,
    values: { email: string; role: ShareRole; walletIds: string[] },
    lang: string
  ): Promise<SharingInvite> {
    const data = (
      await this.api.post<SharingInvite>(`/sharing/profiles/${profileId}/invites`, {
        ...values,
        lang,
      })
    ).data as SharingInvite
    await this.loadOwner(profileId)
    return data
  }

  async resend(profileId: string, inviteId: string, lang: string): Promise<void> {
    await this.api.post(`/sharing/invites/${inviteId}/resend`, { lang })
    await this.loadOwner(profileId)
  }

  async cancel(profileId: string, inviteId: string): Promise<void> {
    await this.api.delete(`/sharing/invites/${inviteId}`)
    await this.loadOwner(profileId)
  }

  async updateMember(
    profileId: string,
    userId: string,
    values: { role: ShareRole; walletIds: string[] }
  ): Promise<void> {
    await this.api.put(`/sharing/profiles/${profileId}/members/${userId}`, values)
    await this.loadOwner(profileId)
  }

  async removeMember(profileId: string, userId: string): Promise<void> {
    await this.api.delete(`/sharing/profiles/${profileId}/members/${userId}`)
    await this.loadOwner(profileId)
  }

  // ---------- Member ----------

  async accept(inviteId: string): Promise<void> {
    try {
      await this.api.post(`/sharing/invites/${inviteId}/accept`, {})
    } finally {
      await this.loadWithMe().catch(() => undefined)
    }
  }

  async decline(inviteId: string): Promise<void> {
    await this.api.post(`/sharing/invites/${inviteId}/decline`, {})
    await this.loadWithMe()
  }

  async leave(profileId: string): Promise<void> {
    await this.api.delete(`/sharing/with-me/${profileId}`)
    await this.loadWithMe()
  }

  private clear(): void {
    this.withMe.set(null)
    this.owners.set(new Map())
    this.readAt.set(null)
    if (this.session) {
      this.endShared()
    }
  }
}

const hasPending = (db: LocalDatabase, rowId: string): boolean =>
  db.selectValue(`SELECT 1 FROM outbox WHERE tbl = 'transactions' AND row_id = ?`, [rowId]) !==
  undefined

const hasOps = (offlineService: OfflineService): boolean =>
  offlineService.sharedActive() &&
  offlineService.db().selectValue(`SELECT 1 FROM outbox WHERE status = 'pending' LIMIT 1`) !==
    undefined
