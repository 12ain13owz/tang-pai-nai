/** The API's response envelope (`createResponse` on the server). */
export interface ApiResponse<T> {
  message: string
  timestamp: string
  data?: T
  /** Machine-readable reason on errors, e.g. `OTP_EXPIRED`. */
  code?: string
}

/** A failed call, flattened for screens. `status` 0 means the API wasn't reached at all. */
export interface ApiError {
  status: number
  code?: string
  message?: string
  /** From `Retry-After` on a `429`. */
  retryAfterSeconds?: number
}
