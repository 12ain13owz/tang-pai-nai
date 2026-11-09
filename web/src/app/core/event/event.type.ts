import type { UserIcon } from '@/shared/components/icon-badge'

/** An event / trip as the device stores it (docs/features/event.md → Data model). */
export interface TripEvent {
  id: string
  profileId: string
  name: string
  icon: string
  color: string
  /** `YYYY-MM-DD`. */
  startOn: string
  /** `YYYY-MM-DD` not before `startOn`, or null (no end set). */
  endOn: string | null
  /** "จบแล้ว" (event rule 6). */
  isClosed: boolean
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number | null
}

/** One currency's money of an event (event rule 4): every tagged row, report or not. */
export interface EventMoney {
  currencyCode: string
  minorUnit: number
  income: number
  expense: number
  net: number
}

/** An event with its computed totals (never stored). */
export interface EventItem {
  event: TripEvent
  money: EventMoney[]
  /** Live tagged transactions. */
  count: number
  /** Wallets those rows are in. */
  walletCount: number
  /** Open and its dates hold today: new rows take it (event rule 5). */
  current: boolean
}

/** An event's expense on one category (its page's "ตามหมวด"). */
export interface EventCategoryShare {
  categoryId: string
  name: string
  icon: string
  color: string
  currencyCode: string
  minorUnit: number
  amount: number
}

/** What the event form edits. */
export interface EventValues {
  name: string
  icon: string
  color: string
  startOn: string
  endOn: string | null
}

export type EventSheetState =
  | { mode: 'create' }
  | { mode: 'edit'; id: string }
  /** "Fix" of a rejected event op, with the refused values. */
  | { mode: 'fix'; opId: string; id: string }

export const EVENTS_ROUTE = '/transactions/events'

export const EVENT_LIMITS = {
  NAME_MAX: 50,
  /** Open events per profile (event rule 1). */
  OPEN_PER_PROFILE: 50,
  FIRST_DAY: '2000-01-01',
} as const

export const EVENT_DEFAULT_ICON: UserIcon = 'lucidePlane'

/** Icons offered for an event: travel first, then occasions. */
export const EVENT_ICONS: readonly UserIcon[] = [
  'lucidePlane',
  'lucideLuggage',
  'lucideHotel',
  'lucideCar',
  'lucideBus',
  'lucideTrainFront',
  'lucideShip',
  'lucideBike',
  'lucideGift',
  'lucideUsers',
  'lucideBaby',
  'lucideGraduationCap',
  'tpnTemple',
  'lucideHouse',
  'lucideUtensils',
  'lucideTicket',
  'lucideMusic',
  'lucideHeartPulse',
  'lucideBriefcase',
  'lucideStar',
]
