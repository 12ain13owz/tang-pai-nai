import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core'
import { ApiClient, isUnreachable, toApiError } from '@/core/api'
import { AuthStore } from '@/core/auth'
import { NetworkStatusService } from '@/core/network'
import type {
  OwnerSharing,
  ShareRole,
  SharedEntries,
  SharedWallet,
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
@Injectable({ providedIn: 'root' })
export class SharingService {
  private api = inject(ApiClient)
  private authStore = inject(AuthStore)
  private network = inject(NetworkStatusService)

  /** Invites to me and wallets shared with me; `null` until read once. */
  withMe = signal<SharedWithMe | null>(null)
  /** The owner's view per profile id. */
  private owners = signal<ReadonlyMap<string, OwnerSharing>>(new Map())
  private wallets = signal<ReadonlyMap<string, SharedWallet>>(new Map())
  private entryPages = signal<ReadonlyMap<string, SharedEntries>>(new Map())
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
  }

  owner(profileId: string): OwnerSharing | null {
    return this.owners().get(profileId) ?? null
  }

  wallet(walletId: string): SharedWallet | null {
    return this.wallets().get(walletId) ?? null
  }

  entries(walletId: string, from: string, to: string | null): SharedEntries | null {
    return this.entryPages().get(`${walletId}|${from}|${to ?? ''}`) ?? null
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
    return data
  }

  async loadWallet(walletId: string): Promise<SharedWallet> {
    const data = (await this.api.get<SharedWallet>(`/sharing/wallets/${walletId}`))
      .data as SharedWallet
    this.wallets.update((map) => new Map(map).set(walletId, data))
    this.readAt.set(Date.now())
    return data
  }

  async loadEntries(walletId: string, from: string, to: string | null): Promise<SharedEntries> {
    const query = `from=${from}${to ? `&to=${to}` : ''}`
    const data = (
      await this.api.get<SharedEntries>(`/sharing/wallets/${walletId}/entries?${query}`)
    ).data as SharedEntries
    this.entryPages.update((map) => new Map(map).set(`${walletId}|${from}|${to ?? ''}`, data))
    this.readAt.set(Date.now())
    return data
  }

  /** A shared wallet went away (404): drop what was read about it. */
  forgetWallet(walletId: string): void {
    this.wallets.update((map) => {
      const next = new Map(map)
      next.delete(walletId)
      return next
    })
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
    this.wallets.set(new Map())
    this.entryPages.set(new Map())
    this.readAt.set(null)
  }
}
