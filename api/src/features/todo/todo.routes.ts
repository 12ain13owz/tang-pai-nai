import { Router } from 'express'
import { validate } from '@/core/middleware'
import { todoSchema } from './todo.schema'
import type { TodoController } from './todo.controller'

export const createTodoRouter = (todoController: TodoController): Router => {
  const router = Router()

  router.get('/', todoController.list)
  router.post('/', validate(todoSchema.create), todoController.create)
  router.get('/:id', validate(todoSchema.byId), todoController.getById)
  router.patch('/:id/toggle', validate(todoSchema.byId), todoController.toggle)
  router.delete('/:id', validate(todoSchema.byId), todoController.remove)

  return router
}
