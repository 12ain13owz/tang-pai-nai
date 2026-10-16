import { createTodoController } from './todo.controller'
import { createMemoryTodoRepository } from './todo.repository.memory'
import { createTodoRouter } from './todo.routes'
import { createTodoService } from './todo.service'

// Composition root: the only place that picks the storage adapter.
// To use a real DB, add `todo.repository.<driver>.ts` (mysql, mongo, sequelize, …) and swap it in
// here without touching service/controller, e.g. `createMysqlTodoRepository(pool)`.
const todoRepo = createMemoryTodoRepository()
const todoService = createTodoService({ todoRepo })
const todoController = createTodoController(todoService)

export const todoRouter = createTodoRouter(todoController)

export type { Todo } from './todo.entity'
