// Log-only strings (console bootstrap + Winston logger), grouped by subsystem — never sent in API responses.
export const LOG = {
  CONFIG: {
    load: (envFile: string) => `[Config] ✅ Loaded environment from: ${envFile}`,
    missing: (envFile: string) => `[Config] ⚠️ Missing environment file: ${envFile}`,
    loadError: (envFile: string) => `[Config] ❌ Unexpected error loading ${envFile}:`,
  },
  SERVER: {
    listening: (baseUrl: string) => `Server listening at ${baseUrl}`,
  },
  DATABASE: {
    migrated: '[Database] ✅ Migrations applied',
    noMigrations: '[Database] No migrations yet (run `npm run db:generate` after adding a table)',
    seeded: (name: string) => `[Database] Seeded ${name}`,
    seedDone: (count: number) => `[Database] ✅ Seed finished (${count} seeders)`,
    seedSkippedInProduction: '[Database] Seed skipped: never runs in production',
  },
  NOTIFICATION: {
    sent: (channel: string, provider: string) => `[Notification] Sent ${channel} via ${provider}`,
  },
  // Auth events (auth spec rule 19). Metadata carries ids only, never codes or tokens.
  AUTH: {
    codeRequested: '[Auth] Sign-in code requested',
    userCreated: '[Auth] User created',
    signedIn: (method: string) => `[Auth] Signed in with ${method}`,
    signInFailed: (method: string) => `[Auth] Sign-in with ${method} failed`,
    refreshReuse: '[Auth] ⚠️ Refresh token reused: session family revoked',
    signedOut: '[Auth] Signed out',
    reauthRequested: '[Auth] Step-up code requested',
    reauthenticated: (method: string) => `[Auth] Identity confirmed with ${method}`,
    reauthFailed: (method: string) => `[Auth] Identity check with ${method} failed`,
    passwordSet: '[Auth] Password set',
    passwordChanged: '[Auth] Password changed',
    passwordRemoved: '[Auth] Password removed',
    passwordRehashed: '[Auth] Password hash upgraded',
    identityLinked: (provider: string) => `[Auth] ${provider} identity linked`,
    identityUnlinked: (provider: string) => `[Auth] ${provider} identity unlinked`,
    identityLinkFailed: (provider: string) => `[Auth] Linking ${provider} failed`,
    sessionRevoked: '[Auth] Session revoked from another device',
    phoneCodeRequested: '[Auth] Phone confirmation code requested',
    phoneConfirmFailed: '[Auth] Phone number confirmation failed',
    phoneAdded: '[Auth] Phone number added',
    phoneChanged: '[Auth] Phone number changed',
    phoneRemoved: '[Auth] Phone number removed',
    smsDailyLimit: (limit: number) => `[Auth] ⚠️ Daily SMS cap (${limit}) reached`,
    otherSessionsRevoked: '[Auth] Other sessions revoked',
    credentialMailSkipped: (reason: string) =>
      `[Auth] ⚠️ Credential change mail not sent: ${reason}`,
    breachCheckUnavailable: '[Auth] ⚠️ Breached-password check unavailable: allowed (fail open)',
    emailDailyLimit: (limit: number) => `[Auth] ⚠️ Daily email cap (${limit}) reached`,
    cleanedUp: (challenges: number, sessions: number, buckets: number) =>
      `[Auth] Cleanup removed ${challenges} challenges, ${sessions} sessions, ${buckets} rate-limit buckets`,
  },
}

// API response pools. Flat on purpose: UPPER_CASE = fixed text, camelCase = builder.
// Feature-specific text goes in `<feature>.const.ts` (e.g. AUTH_MESSAGE), not here.
export const SUCCESS = {
  OK: 'Operation successful',

  list: (name: string) => `Listed ${name} successfully`,
  get: (name: string) => `Fetched ${name} successfully`,
  create: (name: string) => `Created ${name} successfully`,
  update: (name: string) => `Updated ${name} successfully`,
  delete: (name: string) => `Deleted ${name} successfully`,
  save: (name: string) => `Saved ${name} successfully`,
  upload: (name: string) => `Uploaded ${name} successfully`,
}

export const ERRORS = {
  VALIDATION_ERROR: 'An unexpected error occurred during request validation',
  BAD_REQUEST: 'Bad request',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  INTERNAL_SERVER_ERROR: 'Internal server error',
  METHOD_NOT_ALLOWED: 'Method not allowed',
  TOO_MANY_REQUESTS: 'Too many requests. Please try again later',
  BAD_GATEWAY: 'Bad gateway',
  UNSPECIFIED_FUNCTION: 'Unspecified function',
  INVALID_JSON_BODY: 'Invalid JSON in request body',

  notFound: (item: string) => `${item} not found`,
  alreadyExists: (item: string) => `${item} already exists`,
  invalidField: (field: string) => `Invalid ${field} format`,
  invalidType: (field: string, type: string) => `${field} must be of type ${type}`,
  requiredField: (field: string) => `${field} is required`,
  minLength: (field: string, length: number) => `${field} must be at least ${length} characters`,
  maxLength: (field: string, length: number) => `${field} must be at most ${length} characters`,
  failedAction: (action?: string, target?: string) => `Failed to ${action} ${target}`,
  devOnly: (value: string) => `"${value}" is only allowed in development`,
}
