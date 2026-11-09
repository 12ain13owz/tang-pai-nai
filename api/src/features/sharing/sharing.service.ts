import { BusinessRuleError, ConflictError, NotFoundError, TooManyRequestsError } from '@/core/error'
import { NotificationChannel } from '@/shared/types'
import { SHARING_LIMITS as L, SHARING_MESSAGE, ShareErrorCode } from './sharing.const'
import { buildInviteMail } from './sharing.mail'
import type { Entry, Invite, MemberRow, ShareRole, UserRef, WalletRef } from './sharing.entity'
import type { SharingRepository } from './sharing.repository'
import type {
  OwnerSharing,
  SharedEntries,
  SharedWallet,
  SharedWithMe,
  SharingMember,
} from './sharing.type'

type Lang = 'th' | 'en'

export interface SharingServiceDeps {
  sharingRepo: SharingRepository
  notifier: {
    send(mail: {
      channel: NotificationChannel
      to: string
      subject: string
      text: string
    }): Promise<void>
  }
  config: { webOrigin: string; emailDailyLimit: number }
  now?: () => number
}

export interface InviteInput {
  email: string
  role: ShareRole
  walletIds: string[]
}

const unique = (ids: string[]) => [...new Set(ids)]

const tooMany = (code: ShareErrorCode, message: string, retryAfterMs: number) =>
  new TooManyRequestsError(message, Math.max(1, Math.ceil(retryAfterMs / 1000))).withCode(code)

/** Rows of one profile grouped per person (rule 1: one role per person). */
const groupMembers = (rows: MemberRow[]): SharingMember[] => {
  const people = new Map<string, SharingMember>()
  for (const row of rows) {
    const person = people.get(row.userId) ?? {
      userId: row.userId,
      displayName: row.displayName,
      email: row.email,
      role: row.role,
      walletIds: [],
      addedAt: row.addedAt,
    }
    person.walletIds.push(row.walletId)
    person.addedAt = Math.min(person.addedAt, row.addedAt)
    people.set(row.userId, person)
  }
  return [...people.values()]
}

const publicInvite = (invite: Invite) => ({
  id: invite.id,
  email: invite.email,
  role: invite.role,
  walletIds: invite.walletIds,
  createdAt: invite.createdAt,
  expiresAt: invite.expiresAt,
  lastSentAt: invite.lastSentAt,
})

const walletView = (wallet: WalletRef, balance: number) => ({
  id: wallet.id,
  name: wallet.name,
  icon: wallet.icon,
  color: wallet.color,
  currencyCode: wallet.currencyCode,
  balance,
})

export const createSharingService = ({
  sharingRepo,
  notifier,
  config,
  now = () => Date.now(),
}: SharingServiceDeps) => {
  const requireUser = async (userId: string): Promise<UserRef> => {
    const user = await sharingRepo.findUser(userId)
    if (!user) {
      throw new NotFoundError('User', { userId }).withOperation('sharing.user')
    }
    return user
  }

  const requireOwner = async (userId: string, profileId: string, operation: string) => {
    if (!(await sharingRepo.ownsProfile(userId, profileId))) {
      throw new NotFoundError('Profile', { profileId }).withOperation(operation)
    }
  }

  /** Rule 2: the ids, without duplicates, must be open live wallets of the profile. */
  const shareableWallets = async (profileId: string, ids: string[], operation: string) => {
    const wanted = unique(ids)
    const open = (await sharingRepo.openWallets(wanted)).filter((w) => w.profileId === profileId)
    if (open.length !== wanted.length) {
      throw new BusinessRuleError(SHARING_MESSAGE.WALLETS_INVALID)
        .withCode(ShareErrorCode.WALLETS_INVALID)
        .withOperation(operation)
    }
    return open
  }

  /** Rule 4: the owner's daily sends, then the global mail cap, then the mail itself. */
  const sendInviteMail = async (invite: Omit<Invite, 'id'>, lang: Lang, wallets: WalletRef[]) => {
    const at = now()
    const own = await sharingRepo.hitRateLimit(
      `share:invite:${invite.ownerId}:day`,
      L.SENDS_WINDOW_MS,
      at
    )
    if (own.count > L.SENDS_PER_DAY) {
      throw tooMany(
        ShareErrorCode.DAILY_LIMIT,
        SHARING_MESSAGE.DAILY_LIMIT,
        own.windowStart + L.SENDS_WINDOW_MS - at
      )
    }
    const daily = await sharingRepo.hitRateLimit(L.EMAIL_DAILY_KEY, L.EMAIL_DAILY_WINDOW_MS, at)
    if (daily.count > config.emailDailyLimit) {
      throw tooMany(
        ShareErrorCode.RATE_LIMITED,
        SHARING_MESSAGE.DAILY_LIMIT,
        daily.windowStart + L.EMAIL_DAILY_WINDOW_MS - at
      )
    }
    const owner = await requireUser(invite.ownerId)
    const mail = buildInviteMail({
      inviterName: owner.displayName,
      walletNames: wallets.map((w) => w.name),
      role: invite.role,
      email: invite.email,
      webOrigin: config.webOrigin,
      expiresAt: invite.expiresAt,
      lang,
    })
    await notifier.send({ channel: NotificationChannel.EMAIL, to: invite.email, ...mail })
  }

  /** Rule 3: not yourself, not a member, no second pending invite, at most 10 people. */
  const checkInvitee = async (owner: UserRef, profileId: string, email: string) => {
    const operation = 'sharing.invite'
    if (email === owner.email) {
      throw new ConflictError(SHARING_MESSAGE.SELF)
        .withCode(ShareErrorCode.SELF)
        .withOperation(operation)
    }
    const members = groupMembers(await sharingRepo.membersOf(profileId))
    if (members.some((member) => member.email === email)) {
      throw new ConflictError(SHARING_MESSAGE.ALREADY_MEMBER)
        .withCode(ShareErrorCode.ALREADY_MEMBER)
        .withOperation(operation)
    }
    const invites = await sharingRepo.invitesOf(profileId, now())
    if (invites.some((invite) => invite.email === email)) {
      throw new ConflictError(SHARING_MESSAGE.INVITE_PENDING)
        .withCode(ShareErrorCode.INVITE_PENDING)
        .withOperation(operation)
    }
    if (members.length + invites.length >= L.PEOPLE_PER_PROFILE) {
      throw new ConflictError(SHARING_MESSAGE.MEMBER_LIMIT)
        .withCode(ShareErrorCode.MEMBER_LIMIT)
        .withOperation(operation)
    }
  }

  // ---------- Owner ----------

  const ofProfile = async (userId: string, profileId: string): Promise<OwnerSharing> => {
    await requireOwner(userId, profileId, 'sharing.ofProfile')
    const wallets = await sharingRepo.profileWallets(profileId)
    const open = new Set(wallets.filter((w) => !w.isArchived).map((w) => w.id))
    const members = groupMembers(await sharingRepo.membersOf(profileId)).map((member) => ({
      ...member,
      walletIds: member.walletIds.filter((id) => open.has(id)),
    }))
    const invites = (await sharingRepo.invitesOf(profileId, now())).map((invite) => ({
      ...publicInvite(invite),
      walletIds: invite.walletIds.filter((id) => open.has(id)),
    }))
    const shared = new Set(members.flatMap((member) => member.walletIds))
    return {
      members,
      invites,
      unsharedWalletIds: [...open].filter((id) => !shared.has(id)),
    }
  }

  const invite = async (
    userId: string,
    profileId: string,
    input: InviteInput,
    lang: Lang
  ): Promise<ReturnType<typeof publicInvite>> => {
    await requireOwner(userId, profileId, 'sharing.invite')
    const owner = await requireUser(userId)
    const wallets = await shareableWallets(profileId, input.walletIds, 'sharing.invite')
    await sharingRepo.deleteExpiredInvites(now())
    await checkInvitee(owner, profileId, input.email)
    const at = now()
    const fresh = {
      profileId,
      ownerId: userId,
      email: input.email,
      role: input.role,
      walletIds: wallets.map((w) => w.id),
      createdAt: at,
      expiresAt: at + L.INVITE_TTL_MS,
      lastSentAt: at,
    }
    await sendInviteMail(fresh, lang, wallets)
    return publicInvite(await sharingRepo.createInvite(fresh))
  }

  const ownInvite = async (userId: string, inviteId: string, operation: string) => {
    const found = await sharingRepo.findInvite(inviteId, now())
    if (!found || found.ownerId !== userId) {
      throw new NotFoundError('Invite', { inviteId }).withOperation(operation)
    }
    return found
  }

  const resend = async (userId: string, inviteId: string, lang: Lang): Promise<void> => {
    const found = await ownInvite(userId, inviteId, 'sharing.resend')
    const waited = now() - found.lastSentAt
    if (waited < L.RESEND_COOLDOWN_MS) {
      throw tooMany(
        ShareErrorCode.RESEND_COOLDOWN,
        SHARING_MESSAGE.RESEND_COOLDOWN,
        L.RESEND_COOLDOWN_MS - waited
      )
    }
    const wallets = (await sharingRepo.openWallets(found.walletIds)).filter(
      (w) => w.profileId === found.profileId
    )
    await sendInviteMail(found, lang, wallets)
    await sharingRepo.markSent(found.id, now())
  }

  const cancel = async (userId: string, inviteId: string): Promise<void> => {
    const found = await ownInvite(userId, inviteId, 'sharing.cancel')
    await sharingRepo.deleteInvite(found.id)
  }

  const updateMember = async (
    userId: string,
    profileId: string,
    memberId: string,
    change: { role: ShareRole; walletIds: string[] }
  ): Promise<void> => {
    await requireOwner(userId, profileId, 'sharing.updateMember')
    const rows = await sharingRepo.membersOf(profileId)
    if (!rows.some((row) => row.userId === memberId)) {
      throw new NotFoundError('Member', { memberId }).withOperation('sharing.updateMember')
    }
    const wallets = await shareableWallets(profileId, change.walletIds, 'sharing.updateMember')
    await sharingRepo.setMembership(
      profileId,
      memberId,
      change.role,
      wallets.map((w) => w.id),
      now()
    )
  }

  const removeMember = async (userId: string, profileId: string, memberId: string) => {
    await requireOwner(userId, profileId, 'sharing.removeMember')
    await sharingRepo.setMembership(profileId, memberId, 'viewer', [], now())
  }

  // ---------- Member ----------

  /** Rule 6: an invite to my verified email that hasn't expired. */
  const inviteToMe = async (userId: string, inviteId: string, operation: string) => {
    const user = await requireUser(userId)
    const found = await sharingRepo.findInvite(inviteId, now())
    if (!found || !user.emailVerified || found.email !== user.email.toLowerCase()) {
      throw new NotFoundError('Invite', { inviteId }).withOperation(operation)
    }
    return found
  }

  const withMe = async (userId: string): Promise<SharedWithMe> => {
    const user = await requireUser(userId)
    const pending = user.emailVerified
      ? await sharingRepo.invitesTo(user.email.toLowerCase(), now())
      : []
    const invites = []
    for (const found of pending) {
      const wallets = (await sharingRepo.openWallets(found.walletIds)).filter(
        (w) => w.profileId === found.profileId
      )
      const owner = await sharingRepo.findUser(found.ownerId)
      if (wallets.length > 0 && owner) {
        invites.push({
          id: found.id,
          role: found.role,
          owner: { displayName: owner.displayName, email: owner.email },
          wallets: wallets.map((w) => ({ id: w.id, name: w.name })),
          expiresAt: found.expiresAt,
        })
      }
    }
    return { invites, shares: await sharesOf(userId) }
  }

  const sharesOf = async (userId: string): Promise<SharedWithMe['shares']> => {
    const rows = await sharingRepo.sharesOf(userId)
    const balances = await sharingRepo.balances(rows.map((row) => row.wallet.id))
    const groups = new Map<string, SharedWithMe['shares'][number]>()
    for (const { role, wallet } of rows) {
      let group = groups.get(wallet.profileId)
      if (!group) {
        const owner = await sharingRepo.findUser(wallet.ownerId)
        group = {
          profileId: wallet.profileId,
          role,
          owner: {
            id: wallet.ownerId,
            displayName: owner?.displayName ?? '',
            email: owner?.email ?? '',
          },
          wallets: [],
        }
        groups.set(wallet.profileId, group)
      }
      group.wallets.push(walletView(wallet, balances.get(wallet.id) ?? wallet.initialBalance))
    }
    return [...groups.values()]
  }

  const accept = async (userId: string, inviteId: string): Promise<void> => {
    const found = await inviteToMe(userId, inviteId, 'sharing.accept')
    const wallets = (await sharingRepo.openWallets(found.walletIds)).filter(
      (w) => w.profileId === found.profileId
    )
    if (wallets.length === 0) {
      await sharingRepo.deleteInvite(found.id)
      throw new ConflictError(SHARING_MESSAGE.INVITE_EMPTY)
        .withCode(ShareErrorCode.INVITE_EMPTY)
        .withOperation('sharing.accept')
    }
    await sharingRepo.transaction(async (repo) => {
      const kept = (await repo.membersOf(found.profileId))
        .filter((row) => row.userId === userId)
        .map((row) => row.walletId)
      const ids = unique([...kept, ...wallets.map((w) => w.id)])
      await repo.setMembership(found.profileId, userId, found.role, ids, now())
      await repo.deleteInvite(found.id)
    })
  }

  const decline = async (userId: string, inviteId: string): Promise<void> => {
    const found = await inviteToMe(userId, inviteId, 'sharing.decline')
    await sharingRepo.deleteInvite(found.id)
  }

  const leave = async (userId: string, profileId: string): Promise<void> => {
    await sharingRepo.setMembership(profileId, userId, 'viewer', [], now())
  }

  const requireShare = async (userId: string, walletId: string, operation: string) => {
    const share = await sharingRepo.shareOf(userId, walletId)
    if (!share) {
      throw new NotFoundError('Wallet', { walletId }).withOperation(operation)
    }
    return share
  }

  const wallet = async (userId: string, walletId: string): Promise<SharedWallet> => {
    const { role, wallet: found } = await requireShare(userId, walletId, 'sharing.wallet')
    const balances = await sharingRepo.balances([found.id])
    const owner = await sharingRepo.findUser(found.ownerId)
    return {
      wallet: {
        ...walletView(found, balances.get(found.id) ?? found.initialBalance),
        firstOn: await sharingRepo.firstDay(found.id),
      },
      role,
      owner: { displayName: owner?.displayName ?? '', email: owner?.email ?? '' },
      categories: await sharingRepo.categoriesOf(found.profileId),
    }
  }

  const entries = async (
    userId: string,
    walletId: string,
    from: string,
    to: string | null
  ): Promise<SharedEntries> => {
    await requireShare(userId, walletId, 'sharing.entries')
    const rows: Entry[] = await sharingRepo.entries(walletId, from, to, L.ENTRIES_MAX + 1)
    return { entries: rows.slice(0, L.ENTRIES_MAX), truncated: rows.length > L.ENTRIES_MAX }
  }

  return {
    ofProfile,
    invite,
    resend,
    cancel,
    updateMember,
    removeMember,
    withMe,
    accept,
    decline,
    leave,
    wallet,
    entries,
  }
}

export type SharingService = ReturnType<typeof createSharingService>
