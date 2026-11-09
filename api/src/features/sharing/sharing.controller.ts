import { AppError } from '@/core/error'
import { ERRORS, ErrorSeverity, HttpStatus, SUCCESS } from '@/shared/constants'
import { createResponse } from '@/shared/utils'
import type {
  InviteBody,
  InviteParams,
  LangBody,
  MemberBody,
  MemberParams,
  ProfileParams,
  RowsQuery,
} from './sharing.schema'
import type { SharingService } from './sharing.service'
import type { OwnerSharing, SharedProfileRows, SharedWithMe, SharingInvite } from './sharing.type'
import type { NextFunction, Request, Response } from 'express'

/** `req.auth`, set by `authenticate` in front of every sharing route. */
const userOf = (req: Request<unknown, unknown, unknown, unknown>): string => {
  if (!req.auth) {
    throw new AppError(ERRORS.UNAUTHORIZED, HttpStatus.UNAUTHORIZED, ErrorSeverity.WARN)
  }
  return req.auth.userId
}

type Handler<P, B, Q> = (
  req: Request<P, unknown, B, Q>,
  res: Response,
  next: NextFunction
) => Promise<void>

export const createSharingController = (sharingService: SharingService) => {
  /** One shape for every handler: data → response → res.status(...).json(response). */
  const handle =
    <P, B = unknown, Q = unknown>(
      message: string,
      status: HttpStatus,
      work: (req: Request<P, unknown, B, Q>, userId: string) => Promise<unknown>
    ): Handler<P, B, Q> =>
    async (req, res, next) => {
      try {
        const data = await work(req, userOf(req as Request<unknown, unknown, unknown, unknown>))
        const response = createResponse(message, data ?? undefined)
        res.status(status).json(response)
      } catch (error) {
        next(error)
      }
    }

  const ofProfile = handle<ProfileParams>(
    SUCCESS.get('sharing'),
    HttpStatus.OK,
    async (req, userId): Promise<OwnerSharing> =>
      sharingService.ofProfile(userId, req.params.profileId)
  )

  const invite = handle<ProfileParams, InviteBody>(
    SUCCESS.create('invite'),
    HttpStatus.CREATED,
    async (req, userId): Promise<SharingInvite> => {
      const { lang, ...input } = req.body
      return sharingService.invite(userId, req.params.profileId, input, lang)
    }
  )

  const resend = handle<InviteParams, LangBody>(SUCCESS.OK, HttpStatus.OK, async (req, userId) =>
    sharingService.resend(userId, req.params.id, req.body.lang)
  )

  const cancel = handle<InviteParams>(
    SUCCESS.delete('invite'),
    HttpStatus.OK,
    async (req, userId) => sharingService.cancel(userId, req.params.id)
  )

  const updateMember = handle<MemberParams, MemberBody>(
    SUCCESS.update('member'),
    HttpStatus.OK,
    async (req, userId) =>
      sharingService.updateMember(userId, req.params.profileId, req.params.userId, req.body)
  )

  const removeMember = handle<MemberParams>(
    SUCCESS.delete('member'),
    HttpStatus.OK,
    async (req, userId) =>
      sharingService.removeMember(userId, req.params.profileId, req.params.userId)
  )

  const withMe = handle<unknown>(
    SUCCESS.get('sharing'),
    HttpStatus.OK,
    async (_req, userId): Promise<SharedWithMe> => sharingService.withMe(userId)
  )

  const accept = handle<InviteParams>(SUCCESS.OK, HttpStatus.OK, async (req, userId) =>
    sharingService.accept(userId, req.params.id)
  )

  const decline = handle<InviteParams>(SUCCESS.OK, HttpStatus.OK, async (req, userId) =>
    sharingService.decline(userId, req.params.id)
  )

  const leave = handle<ProfileParams>(SUCCESS.OK, HttpStatus.OK, async (req, userId) =>
    sharingService.leave(userId, req.params.profileId)
  )

  const rows = handle<ProfileParams>(
    SUCCESS.list('rows'),
    HttpStatus.OK,
    async (req, userId): Promise<SharedProfileRows> => {
      // Already parsed (coerced, defaults filled) by validate(); Express types it as ParsedQs.
      const query = req.query as RowsQuery
      return sharingService.rows(userId, req.params.profileId, query.since, query.limit)
    }
  )

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
    rows,
  }
}

export type SharingController = ReturnType<typeof createSharingController>
