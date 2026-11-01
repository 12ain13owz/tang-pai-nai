import { createClient } from '@libsql/client'
import { v7 as uuidv7 } from 'uuid'

/**
 * One-off (#7, docs/features/category.md rule 8): gives every live profile that has no category
 * rows at all the default category set, in Thai. New profiles get the set from the device that
 * creates them; only profiles made before #7 (dev data) need this. Each row takes the next
 * `sync_state.last_seq` in one transaction, so devices pull them like any other change.
 *
 *   npx tsx --env-file-if-exists=.env.dev scripts/seed-default-categories.ts
 *
 * Keep the list in step with the web's `DEFAULT_CATEGORIES` (core/category) while this exists.
 */

type Seed = { name: string; icon: string; color: string; children?: Seed[] }

const EXPENSE: Seed[] = [
  {
    name: 'อาหารและเครื่องดื่ม',
    icon: 'lucideUtensils',
    color: '#c2410c',
    children: [
      { name: 'กาแฟ', icon: 'lucideCoffee', color: '#a16207' },
      { name: 'ร้านอาหาร', icon: 'lucideUtensilsCrossed', color: '#c2410c' },
    ],
  },
  {
    name: 'การเดินทาง',
    icon: 'lucideCar',
    color: '#2563eb',
    children: [
      { name: 'น้ำมัน', icon: 'lucideFuel', color: '#2563eb' },
      { name: 'ขนส่งสาธารณะ', icon: 'lucideTrainFront', color: '#0e7490' },
      { name: 'แท็กซี่', icon: 'lucideCarTaxiFront', color: '#a16207' },
    ],
  },
  {
    name: 'ที่อยู่อาศัย',
    icon: 'lucideHouse',
    color: '#0f766e',
    children: [
      { name: 'ค่าเช่า', icon: 'lucideKeyRound', color: '#0f766e' },
      { name: 'ค่าน้ำ', icon: 'tpnFaucet', color: '#0e7490' },
      { name: 'ค่าไฟ', icon: 'lucideZap', color: '#a16207' },
      { name: 'อินเทอร์เน็ต', icon: 'lucideWifi', color: '#9333ea' },
    ],
  },
  { name: 'ช้อปปิ้ง', icon: 'lucideShoppingBag', color: '#db2777' },
  { name: 'บันเทิง', icon: 'lucideClapperboard', color: '#9333ea' },
  { name: 'สุขภาพ', icon: 'lucideHeartPulse', color: '#dc2626' },
  { name: 'การศึกษา', icon: 'lucideGraduationCap', color: '#0e7490' },
  { name: 'ครอบครัว', icon: 'lucideUsers', color: '#15803d' },
  { name: 'ของขวัญและบริจาค', icon: 'lucideGift', color: '#db2777' },
  { name: 'ประกัน', icon: 'lucideShieldCheck', color: '#475569' },
  { name: 'ท่องเที่ยว', icon: 'lucidePlane', color: '#0e7490' },
  { name: 'อื่น ๆ', icon: 'lucideShapes', color: '#475569' },
]

const INCOME: Seed[] = [
  { name: 'เงินเดือน', icon: 'tpnPayslip', color: '#15803d' },
  { name: 'โบนัส', icon: 'lucideAward', color: '#a16207' },
  { name: 'ดอกเบี้ยและเงินปันผล', icon: 'lucideChartLine', color: '#0f766e' },
  { name: 'ขายของ', icon: 'lucideStore', color: '#c2410c' },
  { name: 'ได้รับเงิน', icon: 'lucideHandCoins', color: '#2563eb' },
  { name: 'อื่น ๆ', icon: 'lucideShapes', color: '#475569' },
]

const url = process.env.DATABASE_URL ?? 'file:./data/local.db'
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN })

const run = async (): Promise<void> => {
  const profiles = await client.execute(
    `SELECT p.id, p.user_id FROM profiles p
     WHERE p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.profile_id = p.id)`
  )
  const tx = await client.transaction('write')
  try {
    let written = 0
    for (const profile of profiles.rows) {
      const profileId = profile['id'] as string
      const userId = profile['user_id'] as string
      const insert = async (
        type: string,
        seed: Seed,
        parentId: string | null,
        sortOrder: number
      ): Promise<string> => {
        const now = Date.now()
        const id = uuidv7()
        const seq = await tx.execute(
          'UPDATE sync_state SET last_seq = last_seq + 1 WHERE id = 1 RETURNING last_seq'
        )
        await tx.execute({
          sql: `INSERT INTO categories (id, user_id, profile_id, type, parent_id, name, icon, color,
                  is_archived, sort_order, created_at, updated_at, deleted_at, change_seq, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, ?, ?)`,
          args: [
            id,
            userId,
            profileId,
            type,
            parentId,
            seed.name,
            seed.icon,
            seed.color,
            sortOrder,
            now,
            now,
            Number(seq.rows[0]?.['last_seq']),
            userId,
          ],
        })
        written++
        return id
      }
      for (const [type, seeds] of [
        ['expense', EXPENSE],
        ['income', INCOME],
      ] as const) {
        for (const [index, seed] of seeds.entries()) {
          const parentId = await insert(type, seed, null, index)
          for (const [childIndex, child] of (seed.children ?? []).entries()) {
            await insert(type, child, parentId, childIndex)
          }
        }
      }
    }
    await tx.commit()
    console.log(`Default categories: ${written} rows for ${profiles.rows.length} profile(s)`)
  } catch (error) {
    await tx.rollback()
    throw error
  }
}

try {
  await run()
} finally {
  client.close()
}
