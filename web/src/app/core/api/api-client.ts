import { HttpClient } from '@angular/common/http'
import type { HttpContext } from '@angular/common/http'
import { inject, Service } from '@angular/core'
import { firstValueFrom } from 'rxjs'
import type { ApiResponse } from './api.type'

export interface ApiRequestOptions {
  context?: HttpContext
}

/**
 * Every call to the API goes through here. Paths are relative to `/api` (same origin: the dev
 * proxy and the prod rewrite forward it), so there's no base URL to configure.
 */
@Service()
export class ApiClient {
  private http = inject(HttpClient)
  private readonly PREFIX = '/api'

  async get<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
    return firstValueFrom(this.http.get<ApiResponse<T>>(this.PREFIX + path, options))
  }

  async post<T>(
    path: string,
    body: unknown = {},
    options: ApiRequestOptions = {}
  ): Promise<ApiResponse<T>> {
    return firstValueFrom(this.http.post<ApiResponse<T>>(this.PREFIX + path, body, options))
  }
}
