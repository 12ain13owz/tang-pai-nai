import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http'
import type { EnvironmentProviders } from '@angular/core'
import { authInterceptor } from './auth.interceptor'

/** `HttpClient` with the auth interceptor on every request. */
export const provideAuth = (): EnvironmentProviders =>
  provideHttpClient(withFetch(), withInterceptors([authInterceptor]))
