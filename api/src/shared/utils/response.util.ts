import type { AppResponse } from '@/shared/types'

export const createResponse = <T>(message: string, data?: T): AppResponse<T> => {
  return {
    message: message,
    timestamp: new Date().toISOString(),
    data: data,
  }
}
