import { z } from 'zod'
import { ERRORS } from '@/shared/constants'

// Rule 2: trimmed and lowercased before validation and any lookup.
const email = z
  .string({ error: ERRORS.requiredField('Email') })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: ERRORS.invalidField('email') }))

const startBody = z.object({
  email,
  lang: z.enum(['th', 'en'], { error: ERRORS.invalidField('lang') }).default('th'),
})

const codeBody = z.object({
  email,
  code: z
    .string({ error: ERRORS.requiredField('Code') })
    .trim()
    .regex(/^\d{6}$/, ERRORS.invalidField('code')),
})

// 32 random bytes in base64url = 43 characters.
const tokenBody = z.object({
  token: z
    .string({ error: ERRORS.requiredField('Token') })
    .regex(/^[\w-]{43}$/, ERRORS.invalidField('token')),
})

const verifyBody = z.union([codeBody, tokenBody], { error: ERRORS.requiredField('Code or token') })

export const authSchema = {
  emailStart: { body: startBody },
  emailVerify: { body: verifyBody },
} as const

export type EmailStartInput = z.infer<typeof startBody>
export type EmailVerifyInput = z.infer<typeof verifyBody>
