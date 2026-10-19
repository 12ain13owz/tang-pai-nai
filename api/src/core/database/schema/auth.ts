import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { v7 as uuidv7 } from 'uuid'
import { epochMs, id, timestamps } from '@/core/database/columns'

// Auth tables (docs/features/auth.md → Data model). Raw codes, link tokens and refresh tokens are
// never stored, only their hashes; passwords only as Argon2id PHC strings.

const createdAt = () =>
  epochMs()
    .notNull()
    .$defaultFn(() => new Date())

export const users = sqliteTable('users', {
  id: id(),
  email: text().notNull().unique(),
  displayName: text().notNull(),
  avatarUrl: text(),
  emailVerifiedAt: epochMs(),
  phone: text().unique(),
  phoneVerifiedAt: epochMs(),
  status: text({ enum: ['active', 'disabled'] })
    .notNull()
    .default('active'),
  timezone: text().notNull().default('Asia/Bangkok'),
  ...timestamps,
})

// A row exists only while the user has a password (rule 10).
export const passwordCredentials = sqliteTable('password_credentials', {
  userId: text()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text().notNull(),
  updatedAt: epochMs().notNull(),
})

// Sign-in through an outside provider (4.3: Google). Matched on `sub`, never on email (rule 14).
export const userIdentities = sqliteTable(
  'user_identities',
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text({ enum: ['google'] }).notNull(),
    providerSubject: text().notNull(),
    emailAtLink: text().notNull(),
    createdAt: createdAt(),
    lastUsedAt: epochMs().notNull(),
  },
  (table) => [
    uniqueIndex('user_identities_provider_subject_idx').on(table.provider, table.providerSubject),
    index('user_identities_user_idx').on(table.userId),
  ]
)

export const otpChallenges = sqliteTable(
  'otp_challenges',
  {
    id: id(),
    channel: text({ enum: ['email', 'sms'] }).notNull(),
    purpose: text({ enum: ['sign_in', 'reauth', 'verify_phone'] }).notNull(),
    destination: text().notNull(),
    userId: text().references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text().notNull(),
    linkTokenHash: text(),
    attempts: integer().notNull().default(0),
    expiresAt: epochMs().notNull(),
    consumedAt: epochMs(),
    createdAt: createdAt(),
  },
  (table) => [
    index('otp_challenges_destination_idx').on(table.channel, table.destination, table.createdAt),
    uniqueIndex('otp_challenges_link_token_hash_idx').on(table.linkTokenHash),
  ]
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: text()
      .notNull()
      .$defaultFn(() => uuidv7()),
    tokenHash: text().notNull().unique(),
    expiresAt: epochMs().notNull(),
    absoluteExpiresAt: epochMs().notNull(),
    authTime: epochMs().notNull(),
    revokedAt: epochMs(),
    replacedById: text(),
    lastUsedAt: epochMs().notNull(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (table) => [
    index('sessions_family_idx').on(table.familyId),
    index('sessions_user_idx').on(table.userId),
  ]
)

export const rateLimitBuckets = sqliteTable('rate_limit_buckets', {
  key: text().primaryKey(),
  count: integer().notNull(),
  windowStart: epochMs().notNull(),
})
