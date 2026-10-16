export interface Todo {
  id: string
  title: string
  done: boolean
  createdAt: Date
}

export type NewTodo = Pick<Todo, 'title'>

export type TodoChanges = Partial<Pick<Todo, 'title' | 'done'>>
