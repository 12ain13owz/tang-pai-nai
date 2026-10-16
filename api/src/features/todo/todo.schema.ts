import { z } from 'zod'
import { ERRORS } from '@/shared/constants'

const TITLE_MAX_LENGTH = 200

const createBody = z.object({
  title: z
    .string({ error: ERRORS.requiredField('Title') })
    .trim()
    .min(1, ERRORS.requiredField('Title'))
    .max(TITLE_MAX_LENGTH, ERRORS.maxLength('Title', TITLE_MAX_LENGTH)),
})

const idParams = z.object({
  id: z.uuid({ error: ERRORS.invalidField('todo id') }),
})

export const todoSchema = {
  create: { body: createBody },
  byId: { params: idParams },
} as const

export type CreateTodoInput = z.infer<typeof createBody>
export type TodoIdParams = z.infer<typeof idParams>
