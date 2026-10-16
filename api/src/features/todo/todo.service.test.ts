import { describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError } from '@/core/error'
import { createMemoryTodoRepository } from './todo.repository.memory'
import { createTodoService } from './todo.service'
import type { Todo } from './todo.entity'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

const existing: Todo = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Existing',
  done: false,
  createdAt: new Date('2026-01-01'),
}

// A fresh in-memory repo per test: no vi.mock, no shared state.
const setup = (seed: Todo[] = []) =>
  createTodoService({ todoRepo: createMemoryTodoRepository(seed) })

describe('list', () => {
  it('returns every stored todo', async () => {
    await expect(setup([existing]).list()).resolves.toEqual([existing])
  })
})

describe('getById', () => {
  it('returns the todo when it exists', async () => {
    await expect(setup([existing]).getById(existing.id)).resolves.toEqual(existing)
  })

  it('throws NotFoundError when the id is unknown', async () => {
    await expect(setup().getById(MISSING_ID)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('create', () => {
  it('creates a todo that starts as not done', async () => {
    const todo = await setup().create({ title: 'Write tests' })

    expect(todo).toMatchObject({ title: 'Write tests', done: false })
    expect(todo.id).toEqual(expect.any(String))
  })

  it('throws ConflictError when the title already exists', async () => {
    await expect(setup([existing]).create({ title: existing.title })).rejects.toBeInstanceOf(
      ConflictError
    )
  })
})

describe('toggle', () => {
  it('flips done on each call', async () => {
    const service = setup([existing])

    await expect(service.toggle(existing.id)).resolves.toMatchObject({ done: true })
    await expect(service.toggle(existing.id)).resolves.toMatchObject({ done: false })
  })

  it('throws NotFoundError when the id is unknown', async () => {
    await expect(setup().toggle(MISSING_ID)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('remove', () => {
  it('deletes the todo so it can no longer be found', async () => {
    const service = setup([existing])

    await service.remove(existing.id)

    await expect(service.getById(existing.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when the id is unknown', async () => {
    await expect(setup().remove(MISSING_ID)).rejects.toBeInstanceOf(NotFoundError)
  })
})
