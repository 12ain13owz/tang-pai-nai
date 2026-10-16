import type { ZodType } from 'zod'

/** Route schema group — each key is an optional Zod schema for that request segment */
export type ValidatedShape = {
  params?: ZodType
  query?: ZodType
  body?: ZodType
}
