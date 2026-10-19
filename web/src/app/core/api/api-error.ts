import { HttpErrorResponse } from '@angular/common/http'
import type { ApiError, ApiResponse } from './api.type'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** Normalises anything thrown by `ApiClient` into an `ApiError`. */
export const toApiError = (error: unknown): ApiError => {
  if (!(error instanceof HttpErrorResponse)) {
    return { status: 0 }
  }
  const body: Partial<ApiResponse<unknown>> = isRecord(error.error) ? error.error : {}
  const retryAfter = Number(error.headers.get('Retry-After'))
  return {
    status: error.status,
    code: typeof body.code === 'string' ? body.code : undefined,
    message: typeof body.message === 'string' ? body.message : undefined,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  }
}

/**
 * The API couldn't be reached: no network, or the dev proxy / rewrite answered for it (502–504)
 * without an API body.
 */
export const isUnreachable = (error: ApiError): boolean =>
  error.status === 0 || (error.status >= 502 && error.status <= 504 && !error.code)
