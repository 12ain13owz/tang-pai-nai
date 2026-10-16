import { AppError } from '@/core/error'
import { ErrorSeverity, HttpStatus } from '@/shared/constants'
import type { ValidatedShape } from './validate.type'
import type { NextFunction, Request, RequestHandler, Response } from 'express'

type RequestSource = 'params' | 'query' | 'body'
const SOURCES: RequestSource[] = ['params', 'query', 'body']

const readSource = (req: Request, source: RequestSource): unknown => {
  if (source === 'params') {
    return req.params
  }
  if (source === 'query') {
    return req.query
  }
  return req.body
}

const writeSource = (req: Request, source: RequestSource, data: unknown): void => {
  if (source === 'params') {
    req.params = data as Request['params']
    return
  }

  if (source === 'query') {
    Object.defineProperty(req, 'query', {
      value: data,
      writable: true,
      configurable: true,
      enumerable: true,
    })
    return
  }

  req.body = data
}

export const validate =
  (schema: ValidatedShape): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    for (const source of SOURCES) {
      // eslint-disable-next-line security/detect-object-injection
      const segmentSchema = schema[source]
      if (!segmentSchema) {
        continue
      }

      const result = segmentSchema.safeParse(readSource(req, source))

      if (!result.success) {
        const message = result.error.issues.map((issue) => issue.message).join(', ')
        next(
          new AppError(message, HttpStatus.UNPROCESSABLE_ENTITY, ErrorSeverity.WARN)
            .withOperation('validate')
            .withEndpoint(req)
            .withMetadata({ source })
        )
        return
      }
      writeSource(req, source, result.data)
    }

    next()
  }
