import { HttpStatus, SUCCESS } from '@/shared/constants'
import { createResponse } from '@/shared/utils'
import type { Todo } from './todo.entity'
import type { CreateTodoInput, TodoIdParams } from './todo.schema'
import type { TodoService } from './todo.service'
import type { NextFunction, Request, Response } from 'express'

export const createTodoController = (todoService: TodoService) => {
  const list = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data: Todo[] = await todoService.list()
      const response = createResponse(SUCCESS.list('todos'), data)
      res.status(HttpStatus.OK).json(response)
    } catch (error) {
      next(error)
    }
  }

  const getById = async (
    req: Request<TodoIdParams>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const data: Todo = await todoService.getById(req.params.id)
      const response = createResponse(SUCCESS.get('todo'), data)
      res.status(HttpStatus.OK).json(response)
    } catch (error) {
      next(error)
    }
  }

  const create = async (
    req: Request<unknown, unknown, CreateTodoInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const data: Todo = await todoService.create(req.body)
      const response = createResponse(SUCCESS.create('todo'), data)
      res.status(HttpStatus.CREATED).json(response)
    } catch (error) {
      next(error)
    }
  }

  const toggle = async (
    req: Request<TodoIdParams>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const data: Todo = await todoService.toggle(req.params.id)
      const response = createResponse(SUCCESS.update('todo'), data)
      res.status(HttpStatus.OK).json(response)
    } catch (error) {
      next(error)
    }
  }

  const remove = async (
    req: Request<TodoIdParams>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      await todoService.remove(req.params.id)
      const response = createResponse(SUCCESS.delete('todo'))
      res.status(HttpStatus.OK).json(response)
    } catch (error) {
      next(error)
    }
  }

  return { list, getById, create, toggle, remove }
}

export type TodoController = ReturnType<typeof createTodoController>
