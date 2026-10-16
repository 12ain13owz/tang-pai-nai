import { HttpStatus, SUCCESS } from '@/shared/constants'
import { createResponse } from '@/shared/utils'
import type { NextFunction, Request, Response } from 'express'

export const successController = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const response = createResponse(SUCCESS.OK)
    res.status(HttpStatus.OK).json(response)
  } catch (error) {
    next(error)
  }
}
