// docs/features/event.md → Data model. A type alias (not an interface), so it fits the sync
// layer's `Record<string, unknown>` rows.
export type Event = {
  id: string
  profileId: string
  name: string
  icon: string
  color: string
  /** `YYYY-MM-DD`. */
  startOn: string
  /** `YYYY-MM-DD` or null. */
  endOn: string | null
  isClosed: boolean
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number
  updatedBy: string
}
