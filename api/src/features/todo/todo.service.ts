import { ConflictError, NotFoundError } from '@/core/error'
import { ERRORS } from '@/shared/constants'
import type { NewTodo, Todo } from './todo.entity'
import type { TodoRepository } from './todo.repository'

export interface TodoServiceDeps {
  todoRepo: TodoRepository
}

export const createTodoService = ({ todoRepo }: TodoServiceDeps) => {
  const getById = async (id: string): Promise<Todo> => {
    const todo = await todoRepo.findById(id)
    if (!todo) {
      throw new NotFoundError('Todo', { id }).withOperation('getTodo')
    }
    return todo
  }

  const list = async (): Promise<Todo[]> => todoRepo.findAll()

  const create = async (data: NewTodo): Promise<Todo> => {
    if (await todoRepo.findByTitle(data.title)) {
      throw new ConflictError(ERRORS.alreadyExists('Todo title'), {
        title: data.title,
      }).withOperation('createTodo')
    }
    return todoRepo.create(data)
  }

  const toggle = async (id: string): Promise<Todo> => {
    const todo = await getById(id) // needs the current `done` to flip it
    const updated = await todoRepo.update(id, { done: !todo.done })
    if (!updated) {
      // Deleted between the read and the write
      throw new NotFoundError('Todo', { id }).withOperation('toggleTodo')
    }
    return updated
  }

  const remove = async (id: string): Promise<void> => {
    if (!(await todoRepo.delete(id))) {
      throw new NotFoundError('Todo', { id }).withOperation('removeTodo')
    }
  }

  return { list, getById, create, toggle, remove }
}

export type TodoService = ReturnType<typeof createTodoService>
