/** One category of the default set, named in both languages (category rule 8). */
interface DefaultCategory {
  th: string
  en: string
  icon: string
  color: string
  children?: readonly DefaultCategory[]
}

const OTHER: DefaultCategory = { th: 'อื่น ๆ', en: 'Other', icon: 'lucideShapes', color: '#475569' }

/**
 * The categories a new profile starts with (docs/features/category.md rule 8), written by the
 * device that creates the profile in the same local write, in the app's language at that moment.
 * `api/scripts/seed-default-categories.ts` holds the Thai copy for profiles made before #7.
 */
export const DEFAULT_CATEGORIES: Readonly<
  Record<'expense' | 'income', readonly DefaultCategory[]>
> = {
  expense: [
    {
      th: 'อาหารและเครื่องดื่ม',
      en: 'Food & drink',
      icon: 'lucideUtensils',
      color: '#c2410c',
      children: [
        { th: 'กาแฟ', en: 'Coffee', icon: 'lucideCoffee', color: '#a16207' },
        { th: 'ร้านอาหาร', en: 'Restaurants', icon: 'lucideUtensilsCrossed', color: '#c2410c' },
      ],
    },
    {
      th: 'การเดินทาง',
      en: 'Transport',
      icon: 'lucideCar',
      color: '#2563eb',
      children: [
        { th: 'น้ำมัน', en: 'Fuel', icon: 'lucideFuel', color: '#2563eb' },
        { th: 'ขนส่งสาธารณะ', en: 'Public transport', icon: 'lucideTrainFront', color: '#0e7490' },
        { th: 'แท็กซี่', en: 'Taxi', icon: 'lucideCarTaxiFront', color: '#a16207' },
      ],
    },
    {
      th: 'ที่อยู่อาศัย',
      en: 'Housing',
      icon: 'lucideHouse',
      color: '#0f766e',
      children: [
        { th: 'ค่าเช่า', en: 'Rent', icon: 'lucideKeyRound', color: '#0f766e' },
        { th: 'ค่าน้ำ', en: 'Water', icon: 'tpnFaucet', color: '#0e7490' },
        { th: 'ค่าไฟ', en: 'Electricity', icon: 'lucideZap', color: '#a16207' },
        { th: 'อินเทอร์เน็ต', en: 'Internet', icon: 'lucideWifi', color: '#9333ea' },
      ],
    },
    { th: 'ช้อปปิ้ง', en: 'Shopping', icon: 'lucideShoppingBag', color: '#db2777' },
    { th: 'บันเทิง', en: 'Entertainment', icon: 'lucideClapperboard', color: '#9333ea' },
    { th: 'สุขภาพ', en: 'Health', icon: 'lucideHeartPulse', color: '#dc2626' },
    { th: 'การศึกษา', en: 'Education', icon: 'lucideGraduationCap', color: '#0e7490' },
    { th: 'ครอบครัว', en: 'Family', icon: 'lucideUsers', color: '#15803d' },
    { th: 'ของขวัญและบริจาค', en: 'Gifts & donations', icon: 'lucideGift', color: '#db2777' },
    { th: 'ประกัน', en: 'Insurance', icon: 'lucideShieldCheck', color: '#475569' },
    { th: 'ท่องเที่ยว', en: 'Travel', icon: 'lucidePlane', color: '#0e7490' },
    OTHER,
  ],
  income: [
    { th: 'เงินเดือน', en: 'Salary', icon: 'tpnPayslip', color: '#15803d' },
    { th: 'โบนัส', en: 'Bonus', icon: 'lucideAward', color: '#a16207' },
    {
      th: 'ดอกเบี้ยและเงินปันผล',
      en: 'Interest & dividends',
      icon: 'lucideChartLine',
      color: '#0f766e',
    },
    { th: 'ขายของ', en: 'Sales', icon: 'lucideStore', color: '#c2410c' },
    { th: 'ได้รับเงิน', en: 'Money received', icon: 'lucideHandCoins', color: '#2563eb' },
    OTHER,
  ],
}

/**
 * The default set as rows of `categories` for a new profile, parents before their children (so
 * they are pushed in that order). `newId` makes the ids (UUIDv7).
 */
export const defaultCategoryRows = (
  profileId: string,
  language: 'th' | 'en',
  now: number,
  newId: () => string
): (Record<string, unknown> & { id: string })[] => {
  const rows: (Record<string, unknown> & { id: string })[] = []
  for (const type of ['expense', 'income'] as const) {
    DEFAULT_CATEGORIES[type].forEach((seed, index) => {
      const parentId = newId()
      const row = (item: DefaultCategory, id: string, parent: string | null, order: number) => ({
        id,
        profileId,
        type,
        parentId: parent,
        name: item[language],
        icon: item.icon,
        color: item.color,
        isArchived: false,
        sortOrder: order,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      rows.push(row(seed, parentId, null, index))
      seed.children?.forEach((child, childIndex) => {
        rows.push(row(child, newId(), parentId, childIndex))
      })
    })
  }
  return rows
}
