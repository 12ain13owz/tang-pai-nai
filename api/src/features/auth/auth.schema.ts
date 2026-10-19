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
})

// DELETE may come without a body at all.
const passwordRemoveBody = z
  .object({ currentPassword: password('Current password').optional() })
  .default({})

const reauthStartBody = z.object({ lang }).default({ lang: 'th' })
const reauthVerifyBody = z.object({ code })

export const authSchema = {
  emailStart: { body: startBody },
  emailVerify: { body: verifyBody },
  passwordSignIn: { body: passwordSignInBody },
  passwordSet: { body: passwordSetBody },
  passwordRemove: { body: passwordRemoveBody },
  reauthStart: { body: reauthStartBody },
  reauthVerify: { body: reauthVerifyBody },
} as const

export type EmailStartInput = z.infer<typeof startBody>
export type EmailVerifyInput = z.infer<typeof verifyBody>
export type PasswordSignInInput = z.infer<typeof passwordSignInBody>
export type PasswordSetInput = z.infer<typeof passwordSetBody>
export type PasswordRemoveInput = z.infer<typeof passwordRemoveBody>
export type ReauthStartInput = z.infer<typeof reauthStartBody>
export type ReauthVerifyInput = z.infer<typeof reauthVerifyBody>
