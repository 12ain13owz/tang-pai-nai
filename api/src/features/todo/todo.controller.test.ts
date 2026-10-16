import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { errorHandler } from '@/core/error'
import { HttpStatus } from '@/shared/constants'
import type { AppResponse } from '@/shared/types'
import { createTodoController } from './todo.controller'
import { createMemoryTodoRepository } from './todo.repository.memory'
import { createTodoRouter } from './todo.routes'
import { createTodoService } from './todo.service'
import type { Todo } from './todo.entity'
import type { Express } from 'express'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

// Wire the feature with its own repo per test, so tests never share todos
// (the app-level router in index.ts keeps one repo for the whole process).
const buildApp = (seed: Todo[] = []): Express => {
  const todoService = createTodoService({ todoRepo: createMemoryTodoRepository(seed) })
  const app = express()
  app.use(express.json())
  app.use('/todos', createTodoRouter(createTodoController(todoService)))
  app.use(errorHandler)
  return app
}

const existing: Todo = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Existing',
  done: false,
  createdAt: new Date('2026-01-01'),
}

describe('POST /todos', () => {
  it('returns 201 with the created todo and a trimmed title', async () => {
    const res = await request(buildApp()).post('/todos').send({ title: '  Buy milk  ' })
    const body = res.body as AppResponse<Todo>

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(body.data).toMatchObject({ title: 'Buy milk', done: false })
  })

  it('returns 422 when the title is blank', async () => {
    const res = await request(buildApp()).post('/todos').send({ title: '   ' })
    const body = res.body as AppResponse<undefined>

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(body.message).toBe('Title is required')
  })

  it('returns 409 when the title already exists', async () => {
    const res = await request(buildApp([existing]))
      .post('/todos')
      .send({ title: 'Existing' })

    expect(res.status).toBe(HttpStatus.CONFLICT)
  })
})

describe('GET /todos', () => {
  it('returns 200 with every todo', async () => {
    const res = await request(buildApp([existing])).get('/todos')
    const body = res.body as AppResponse<Todo[]>

    expect(res.status).toBe(HttpStatus.OK)
    expect(body.data).toHaveLength(1)
  })
})

describe('GET /todos/:id', () => {
  it('returns 422 when the id is not a UUID', async () => {
    const res = await request(buildApp()).get('/todos/not-a-uuid')

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
  })

  it('returns 404 when the todo does not exist', async () => {
    const res = await request(buildApp()).get(`/todos/${MISSING_ID}`)
    const body = res.body as AppResponse<undefined>

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(body.message).toBe('Todo not found')
  })
})

describe('PATCH /todos/:id/toggle', () => {
  it('returns 200 with done flipped', async () => {
    const res = await request(buildApp([existing])).patch(`/todos/${existing.id}/toggle`)
    const body = res.body as AppResponse<Todo>

    expect(res.status).toBe(HttpStatus.OK)
    expect(body.data?.done).toBe(true)
  })
})

describe('DELETE /todos/:id', () => {
  it('returns 200 and the todo is gone afterwards', async () => {
    const app = buildApp([existing])

    const res = await request(app).delete(`/todos/${existing.id}`)
    expect(res.status).toBe(HttpStatus.OK)

    const after = await request(app).get(`/todos/${existing.id}`)
    expect(after.status).toBe(HttpStatus.NOT_FOUND)
  })
})
