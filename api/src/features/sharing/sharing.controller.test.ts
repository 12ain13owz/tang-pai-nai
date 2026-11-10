import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { errorHandler } from '@/core/error'
import { accessTokens } from '@/core/security'
import { HttpStatus } from '@/shared/constants'
import type { AppResponse } from '@/shared/types'
import { createSharingController } from './sharing.controller'
import { EMAIL, ID, setUpSharing } from './sharing.fixture'
import { createSharingRouter } from './sharing.routes'
import type { SharedProfileRows, SharedWithMe, SharingInvite } from './sharing.type'

// The HTTP side of /sharing (auth, validation, envelopes, codes). The rules are in
// sharing.service.test.ts.
let setup: Awaited<ReturnType<typeof setUpSharing>>
let app: express.Express

beforeEach(async () => {
  setup = await setUpSharing()
  app = express()
  app.use(express.json())
  app.use('/sharing', createSharingRouter(createSharingController(setup.service)))
  app.use(errorHandler)
})

afterEach(() => {
  setup.close()
})

const bearer = async (userId: string) =>
  `Bearer ${await accessTokens.sign({ sub: userId, sid: 'family-1' })}`

const invite = async (body: Record<string, unknown>) =>
  request(app)
    .post(`/sharing/profiles/${ID.pa}/invites`)
    .set('Authorization', await bearer(ID.alice))
    .send(body)

describe('/sharing', () => {
  it('answers 401 without a Bearer token', async () => {
    const res = await request(app).get('/sharing/with-me')
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('invites with a trimmed, lower-case email (201) and refuses bad input (422)', async () => {
    const res = await invite({ email: ' BOB@Example.com ', role: 'viewer', walletIds: [ID.home] })
    const body = res.body as AppResponse<SharingInvite>
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(body.data).toMatchObject({ email: EMAIL.bob, role: 'viewer', walletIds: [ID.home] })

    expect(
      (await invite({ email: 'x@example.com', role: 'owner', walletIds: [ID.home] })).status
    ).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect((await invite({ email: 'x@example.com', role: 'viewer', walletIds: [] })).status).toBe(
      HttpStatus.UNPROCESSABLE_ENTITY
    )
  })

  it('sends the code beside the message on a refused invite', async () => {
    await invite({ email: EMAIL.bob, role: 'viewer', walletIds: [ID.home] })
    const res = await invite({ email: EMAIL.bob, role: 'viewer', walletIds: [ID.home] })
    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect((res.body as { code: string }).code).toBe('SHARE_INVITE_PENDING')
  })

  it('sets Retry-After on the resend cooldown', async () => {
    const created = (await invite({ email: EMAIL.bob, role: 'viewer', walletIds: [ID.home] }))
      .body as AppResponse<SharingInvite>
    const res = await request(app)
      .post(`/sharing/invites/${created.data?.id}/resend`)
      .set('Authorization', await bearer(ID.alice))
    expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0)
  })

  it("lets the invitee accept, then read the shared profile's rows", async () => {
    const created = (await invite({ email: EMAIL.bob, role: 'editor', walletIds: [ID.home] }))
      .body as AppResponse<SharingInvite>
    const auth = await bearer(ID.bob)
    const accepted = await request(app)
      .post(`/sharing/invites/${created.data?.id}/accept`)
      .set('Authorization', auth)
    expect(accepted.status).toBe(HttpStatus.OK)

    const mine = (await request(app).get('/sharing/with-me').set('Authorization', auth))
      .body as AppResponse<SharedWithMe>
    expect(mine.data?.shares[0].wallets.map((wallet) => wallet.id)).toEqual([ID.home])

    const rows = await request(app)
      .get(`/sharing/with-me/${ID.pa}/rows?since=2&limit=1`)
      .set('Authorization', auth)
    expect(rows.status).toBe(HttpStatus.OK)
    expect((rows.body as AppResponse<SharedProfileRows>).data).toMatchObject({
      cursor: 6,
      hasMore: true,
    })

    const bad = await request(app)
      .get(`/sharing/with-me/${ID.pa}/rows?limit=0`)
      .set('Authorization', auth)
    expect(bad.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
  })

  it('answers 404 for a profile that shares nothing with the caller', async () => {
    const res = await request(app)
      .get(`/sharing/with-me/${ID.pa}/rows`)
      .set('Authorization', await bearer(ID.carol))
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
