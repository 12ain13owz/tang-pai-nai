/** The signed-in user as the web app sees it. */
export interface AuthUserData {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
  timezone: string
}

/** `data` of sign-in and refresh. The refresh token only travels in the cookie. */
export interface AuthSessionData {
  accessToken: string
  /** Seconds until `accessToken` expires. */
  expiresIn: number
  user: AuthUserData
}
