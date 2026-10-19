import { HttpContext, HttpContextToken } from '@angular/common/http'

/** Requests marked with this skip the interceptor's refresh-and-retry on `401`. */
export const SKIP_AUTH_REFRESH = new HttpContextToken<boolean>(() => false)

export const skipAuthRefresh = (): HttpContext => new HttpContext().set(SKIP_AUTH_REFRESH, true)
