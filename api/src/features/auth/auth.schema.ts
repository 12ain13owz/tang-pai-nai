import { z } from 'zod'
import { ERRORS } from '@/shared/constants'

// Rule 2: trimmed and lowercased before validation and any lookup.
const email = z
  .string({ error: ERRORS.requiredField('Email') })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: ERRORS.invalidField('email') }))

const lang = z.enum(['th', 'en'], { error: ERRORS.invalidField('lang') }).default('th')

const code = z
  .string({ error: ERRORS.requiredField('Code') })
  .trim()
  .regex(/^\d{6}$/, ERRORS.invalidField('code'))

// Passwords are never trimmed (rule 11). The policy itself (8–128 code points, …) is a business
// rule with its own error codes; this only caps the body so nobody hashes a megabyte.
const PASSWORD_INPUT_MAX = 1024
const password = (field: string) =>
  z
    .string({ error: ERRORS.requiredField(field) })
    .min(1, ERRORS.requiredField(field))
    .max(PASSWORD_INPUT_MAX, ERRORS.maxLength(field, PASSWORD_INPUT_MAX))

const startBody = z.object({ email, lang })

const codeBody = z.object({ email, code })

// 32 random bytes in base64url = 43 characters.
const tokenBody = z.object({
  token: z
    .string({ error: ERRORS.requiredField('Token') })
    .regex(/^[\w-]{43}$/, ERRORS.invalidField('token')),
})

const verifyBody = z.union([codeBody, tokenBody], { error: ERRORS.requiredField('Code or token') })

const passwordSignInBody = z.object({ email, password: password('Password') })

const passwordSetBody = z.object({
  newPassword: password('New password'),
  currentPassword: password('Current password').optional(),
  lang,
})

// Credential changes under recent auth (rules 13, 29, 30): an optional current password as the
// proof, and the language of the change mail (rule 31). DELETE may come without a body at all,
// and a default skips the inner defaults, so it spells out `lang`.
const recentAuthBody = z
  .object({ currentPassword: password('Current password').optional(), lang })
  .default({ lang: 'th' })

const reauthStartBody = z.object({ lang }).default({ lang: 'th' })
const reauthVerifyBody = z.object({ code })

// Google sends the browser to these (rule 14), so a bad value never fails validation: it's
// dropped, and the callback then redirects to the web app's error page instead of showing JSON.
const queryValue = (max: number) => z.string().max(max).optional().catch(undefined)

const googleStartQuery = z.object({
  returnUrl: queryValue(2048),
  lang: z.enum(['th', 'en']).default('th').catch('th'),
})

// Rule 28: a session family id (UUIDv7).
const sessionParams = z.object({
  id: z.uuid({ error: ERRORS.invalidField('id') }),
})

const googleCallbackQuery = z.object({
  code: queryValue(2048),
  state: queryValue(256),
  error: queryValue(256),
})

export const authSchema = {
  emailStart: { body: startBody },
  emailVerify: { body: verifyBody },
  passwordSignIn: { body: passwordSignInBody },
  passwordSet: { body: passwordSetBody },
  passwordRemove: { body: recentAuthBody },
  googleLink: { body: recentAuthBody },
  googleUnlink: { body: recentAuthBody },
  sessionRevoke: { params: sessionParams },
  reauthStart: { body: reauthStartBody },
  reauthVerify: { body: reauthVerifyBody },
  googleStart: { query: googleStartQuery },
  googleCallback: { query: googleCallbackQuery },
} as const

export type EmailStartInput = z.infer<typeof startBody>
export type EmailVerifyInput = z.infer<typeof verifyBody>
export type PasswordSignInInput = z.infer<typeof passwordSignInBody>
export type PasswordSetInput = z.infer<typeof passwordSetBody>
export type RecentAuthInput = z.infer<typeof recentAuthBody>
export type SessionParams = z.infer<typeof sessionParams>
export type ReauthStartInput = z.infer<typeof reauthStartBody>
export type ReauthVerifyInput = z.infer<typeof reauthVerifyBody>
export type GoogleStartQuery = z.infer<typeof googleStartQuery>
export type GoogleCallbackQuery = z.infer<typeof googleCallbackQuery>
