import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { errorHandler } from '@/core/error'
import { accessTokens } from '@/core/security'
import { createSyncRegistry } from '@/core/sync'
import type { SyncValidation } from '@/core/sync'
import { HttpStatus } from '@/shared/constants'
import type { AppResponse } from '@/shared/types'
import { createSyncController } from './sync.controller'
import { createMemorySyncRepository } from './sync.repository.memory'
import { createSyncRouter } from './sync.routes'
import { createSyncService } from './sync.service'
import type { PullResult } from './sync.entity'
import type { SyncPushData } from './sync.type'

// The HTTP side of /sync (validation, auth, envelopes, 410). The rules are in sync.service.test.ts.

const DEVICE = '11111111-1111-4111-8111-111111111111'
const OP_ID = '0199a000-0000-7000-8000-000000000001'

const buildApp = () => {
  const registry = createSyncRegistry()
  const unused = async () => Promise.reject(new Error('unused'))
  registry.register({
    table: 'notes',
    pull: unused,
    push: {
      validate: (row): SyncValidation => ({ ok: true, row: row as never }),
      find: unused,
      check: unused,
      write: unused,
      purge: unused,
    },
  })
  const memory = createMemorySyncRepository({
    shared: { currencies: [{ id: 'THB', changeSeq: 1, updatedAt: 1 }] },
  })
  registry.register({ table: 'currencies', pull: unused })
  const service = createSyncService({ syncRepo: memory.repo, registry, newId: () => 'h1' })
  const app = express()
  app.use(express.json())
  app.use('/sync', createSyncRouter(createSyncController(service)))
  app.use(errorHandler)
  return { app, memory }
}

const bearer = async (userId = 'alice') =>
  `Bearer ${await accessTokens.sign({ sub: userId, sid: 'family-1' })}`

const note = { id: 'n1', title: 'Coffee', createdAt: 1, updatedAt: 1 }

describe('GET /sync/pull', () => {
  it('answers the changes, cursor and tables', async () => {
    const { app } = buildApp()
    const res = await request(app)
      .get(`/sync/pull?deviceId=${DEVICE}`)
      .set('Authorization', await bearer())
    const body = res.body as AppResponse<PullResult>
    expect(res.status).toBe(HttpStatus.OK)
    expect(body.data).toMatchObject({
      changes: [{ table: 'currencies', row: { id: 'THB' } }],
      notices: [],
      cursor: 1,
      hasMore: false,
      tables: ['notes', 'currencies'],
    })
  })

  it('needs a bearer token', async () => {
    const { app } = buildApp()
    const res = await request(app).get(`/sync/pull?deviceId=${DEVICE}`)
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it.each([
    ['no deviceId', ''],
    ['a negative since', `deviceId=${DEVICE}&since=-1`],
    ['a limit over 1000', `deviceId=${DEVICE}&limit=1001`],
  ])('refuses %s with 422', async (_name, query) => {
    const { app } = buildApp()
    const res = await request(app)
      .get(`/sync/pull?${query}`)
      .set('Authorization', await bearer())
    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
  })

  it('answers 410 CURSOR_EXPIRED below the purge watermark', async () => {
    const { app, memory } = buildApp()
    await memory.repo.raisePurgedSeq(10)
    const res = await request(app)
      .get(`/sync/pull?deviceId=${DEVICE}&since=5`)
      .set('Authorization', await bearer())
    expect(res.status).toBe(HttpStatus.GONE)
    expect(res.body).toMatchObject({ code: 'CURSOR_EXPIRED' })
  })
})

describe('POST /sync/push', () => {
  it('answers a result per op', async () => {
    const { app } = buildApp()
    const res = await request(app)
      .post('/sync/push')
      .set('Authorization', await bearer())
      .send({
        deviceId: DEVICE,
        ops: [{ opId: OP_ID, table: 'notes', op: 'upsert', row: note, baseSeq: null }],
      })
    const body = res.body as AppResponse<SyncPushData>
    expect(res.status).toBe(HttpStatus.OK)
    expect(body.data?.results).toMatchObject([
      { opId: OP_ID, status: 'applied', changeSeq: 2, row: { id: 'n1', updatedBy: 'alice' } },
    ])
  })

  it('needs a bearer token', async () => {
    const { app } = buildApp()
    const res = await request(app).post('/sync/push').send({ deviceId: DEVICE, ops: [] })
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it.each([
    ['no ops', { deviceId: DEVICE, ops: [] }],
    [
      'more than 100 ops',
      {
        deviceId: DEVICE,
        ops: Array.from({ length: 101 }, () => ({
          opId: OP_ID,
          table: 'notes',
          op: 'upsert',
          row: note,
          baseSeq: null,
        })),
      },
    ],
    [
      'an op that is neither upsert nor delete',
      {
        deviceId: DEVICE,
        ops: [{ opId: OP_ID, table: 'notes', op: 'drop', row: note, baseSeq: 1 }],
      },
    ],
    [
      'a row without an id',
      {
        deviceId: DEVICE,
        ops: [{ opId: OP_ID, table: 'notes', op: 'upsert', row: {}, baseSeq: 1 }],
      },
    ],
    [
      'an opId that is not a UUID',
      {
        deviceId: DEVICE,
        ops: [{ opId: 'x', table: 'notes', op: 'upsert', row: note, baseSeq: 1 }],
      },
    ],
  ])('refuses %s with 422', async (_name, body) => {
    const { app } = buildApp()
    const res = await request(app)
      .post('/sync/push')
      .set('Authorization', await bearer())
      .send(body)
    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
  })
})
