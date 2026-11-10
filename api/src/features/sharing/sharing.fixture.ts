import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from '@/core/config'
import type { Database } from '@/core/database'
import { createDatabase } from '@/core/database/client'
import {
  categories,
  debtEntries,
  debts,
  profiles,
  transactions,
  transfers,
  users,
  wallets,
} from '@/core/database/schema'
import type { NotificationChannel } from '@/shared/types'
import { createDrizzleSharingRepository } from './sharing.repository.drizzle'
import { createSharingService } from './sharing.service'

// Test data for sharing (docs/features/sharing.md): ids are UUIDs so HTTP tests pass validation.
export const ID = {
  alice: '00000000-0000-7000-8000-00000000000a',
  bob: '00000000-0000-7000-8000-00000000000b',
  carol: '00000000-0000-7000-8000-00000000000c',
  pa: '00000000-0000-7000-8000-0000000000a1',
  pb: '00000000-0000-7000-8000-0000000000b1',
  home: '00000000-0000-7000-8000-000000000001',
  cash: '00000000-0000-7000-8000-000000000002',
  old: '00000000-0000-7000-8000-000000000003',
  gone: '00000000-0000-7000-8000-000000000004',
  bobs: '00000000-0000-7000-8000-000000000005',
  food: '00000000-0000-7000-8000-0000000000c1',
  pay: '00000000-0000-7000-8000-0000000000c2',
} as const

export const EMAIL = {
  alice: 'alice@example.com',
  bob: 'bob@example.com',
  carol: 'carol@example.com',
} as const

const sync = (changeSeq: number) => ({
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  changeSeq,
  updatedBy: 'device',
})

const wallet = (id: string, profileId: string, userId: string, name: string, extra = {}) => ({
  id,
  userId,
  profileId,
  name,
  currencyCode: 'THB',
  initialBalance: 100_000,
  icon: 'lucideWallet',
  color: '#2563eb',
  excludeFromTotal: false,
  isArchived: false,
  sortOrder: 0,
  ...sync(1),
  ...extra,
})

const seed = async (db: Database) => {
  await db.insert(users).values([
    { id: ID.alice, email: EMAIL.alice, displayName: 'Alice', emailVerifiedAt: new Date(1) },
    { id: ID.bob, email: EMAIL.bob, displayName: 'Bob', emailVerifiedAt: new Date(1) },
    // Carol never verified her email: invitations don't match her (rule 6).
    { id: ID.carol, email: EMAIL.carol, displayName: 'Carol' },
  ])
  await db.insert(profiles).values([
    {
      id: ID.pa,
      userId: ID.alice,
      name: 'Family',
      icon: 'lucideHouse',
      color: '#000',
      sortOrder: 0,
      ...sync(1),
    },
    {
      id: ID.pb,
      userId: ID.bob,
      name: 'Bob',
      icon: 'lucideHouse',
      color: '#000',
      sortOrder: 0,
      ...sync(1),
    },
  ])
  await db
    .insert(wallets)
    .values([
      wallet(ID.home, ID.pa, ID.alice, 'Home'),
      wallet(ID.cash, ID.pa, ID.alice, 'Cash', { sortOrder: 1 }),
      wallet(ID.old, ID.pa, ID.alice, 'Old', { isArchived: true, sortOrder: 2 }),
      wallet(ID.gone, ID.pa, ID.alice, 'Gone', { deletedAt: 5 }),
      wallet(ID.bobs, ID.pb, ID.bob, 'Bobs'),
    ])
  const category = (id: string, type: 'income' | 'expense', name: string) => ({
    id,
    userId: ID.alice,
    profileId: ID.pa,
    type,
    parentId: null,
    name,
    icon: 'lucideUtensils',
    color: '#c2410c',
    isArchived: false,
    sortOrder: 0,
    ...sync(1),
  })
  await db
    .insert(categories)
    .values([category(ID.food, 'expense', 'Food'), category(ID.pay, 'income', 'Pay')])
  const tx = (id: string, categoryId: string, amount: number, occurredOn: string, extra = {}) => ({
    id,
    userId: ID.alice,
    profileId: ID.pa,
    walletId: ID.home,
    categoryId,
    amount,
    occurredOn,
    note: '',
    excludeFromReport: false,
    ...sync(2),
    ...extra,
  })
  await db
    .insert(transactions)
    .values([
      tx('t1', ID.pay, 50_000, '2026-10-01'),
      tx('t2', ID.food, 4_200, '2026-11-09', { note: 'lunch', changeSeq: 6 }),
      tx('t3', ID.food, 999, '2026-11-08', { deletedAt: 3, changeSeq: 7 }),
    ])
  await db.insert(transfers).values({
    id: 'tr1',
    userId: ID.alice,
    profileId: ID.pa,
    fromWalletId: ID.home,
    toWalletId: ID.cash,
    amount: 10_000,
    occurredOn: '2026-11-05',
    note: '',
    ...sync(3),
  })
  await db.insert(debts).values({
    id: 'd1',
    userId: ID.alice,
    profileId: ID.pa,
    direction: 'borrowed',
    person: 'Mom',
    note: '',
    currencyCode: 'THB',
    countAs: 'spent',
    ...sync(4),
  })
  await db.insert(debtEntries).values({
    id: 'de1',
    userId: ID.alice,
    profileId: ID.pa,
    debtId: 'd1',
    kind: 'principal',
    walletId: ID.home,
    amount: 3_000,
    occurredOn: '2026-11-07',
    note: '',
    ...sync(5),
  })
}

export interface SentMail {
  channel: NotificationChannel
  to: string
  subject: string
  text: string
}

/** A temporary SQLite file with the committed migrations, seeded, and a service on it. */
export const setUpSharing = async (start = Date.UTC(2026, 10, 9)) => {
  const dir = mkdtempSync(join(tmpdir(), 'tpn-sharing-'))
  const created = createDatabase({ ...env, DATABASE_URL: `file:${join(dir, 'test.db')}` })
  await migrate(created.db, { migrationsFolder: 'drizzle' })
  await seed(created.db)
  const clock = { now: start }
  const sent: SentMail[] = []
  const service = createSharingService({
    sharingRepo: createDrizzleSharingRepository(created.db),
    notifier: {
      send: async (mail) => {
        sent.push(mail)
        await Promise.resolve()
      },
    },
    config: { webOrigin: 'http://localhost:4200', emailDailyLimit: 100 },
    now: () => clock.now,
  })
  const close = () => {
    created.client.close()
    rmSync(dir, { recursive: true, force: true })
  }
  return { db: created.db, service, sent, clock, close }
}
