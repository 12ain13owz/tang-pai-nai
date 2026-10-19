/** Who is calling, set on `req.auth` by `authenticate`. */
export interface AuthContext {
  userId: string
  /** Session family of the access token (`sid`), e.g. to flag "this device" or sign it out. */
  sessionFamilyId: string
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext
  }
}
