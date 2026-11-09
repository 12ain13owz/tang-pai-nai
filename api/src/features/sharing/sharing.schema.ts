import { z } from 'zod'
import { ERRORS } from '@/shared/constants'
import { SHARING_LIMITS } from './sharing.const'

// Trimmed and lowercased like sign-in's email (auth rule 2), so it matches `users.email`.
const email = z
  .string({ error: ERRORS.requiredField('Email') })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: ERRORS.invalidField('email') }))

const lang = z.enum(['th', 'en'], { error: ERRORS.invalidField('lang') }).default('th')
const role = z.enum(['editor', 'viewer'], { error: ERRORS.invalidField('role') })
const uuid = (name: string) => z.uuid({ error: ERRORS.invalidField(name) })
const walletIds = z.array(uuid('wallet id')).max(SHARING_LIMITS.WALLETS_MAX)
const day = z.iso.date({ error: ERRORS.invalidField('date') })

const profileParams = z.object({ profileId: uuid('profile id') })
const memberParams = z.object({ profileId: uuid('profile id'), userId: uuid('user id') })
const inviteParams = z.object({ id: uuid('invite id') })
const walletParams = z.object({ walletId: uuid('wallet id') })

const inviteBody = z.object({ email, role, walletIds: walletIds.min(1), lang })
const memberBody = z.object({ role, walletIds })
const langBody = z.object({ lang }).default({ lang: 'th' })
const entriesQuery = z.object({ from: day, to: day.optional() })

export const sharingSchema = {
  ofProfile: { params: profileParams },
  invite: { params: profileParams, body: inviteBody },
  resend: { params: inviteParams, body: langBody },
  byInvite: { params: inviteParams },
  member: { params: memberParams, body: memberBody },
  byMember: { params: memberParams },
  leave: { params: profileParams },
  wallet: { params: walletParams },
  entries: { params: walletParams, query: entriesQuery },
} as const

export type ProfileParams = z.infer<typeof profileParams>
export type MemberParams = z.infer<typeof memberParams>
export type InviteParams = z.infer<typeof inviteParams>
export type WalletParams = z.infer<typeof walletParams>
export type InviteBody = z.infer<typeof inviteBody>
export type MemberBody = z.infer<typeof memberBody>
export type LangBody = z.infer<typeof langBody>
export type EntriesQuery = z.infer<typeof entriesQuery>
