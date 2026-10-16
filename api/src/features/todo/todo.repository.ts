import type { NewTodo, Todo, TodoChanges } from './todo.entity'

/**
 * Port: what the service needs from storage. Implementations live in
 * `todo.repository.<driver>.ts` and are picked in `index.ts`.
 * Never throws for a missing id: reads/updates return `null`, delete returns `false`.
 * The service decides whether that is an error.
 */
export interface TodoRepository {
  findAll(): Promise<Todo[]>
  findById(id: string): Promise<Todo | null>
  findByTitle(title: string): Promise<Todo | null>
  create(data: NewTodo): Promise<Todo>
  update(id: string, changes: TodoChanges): Promise<Todo | null>
  delete(id: string): Promise<boolean>
}
