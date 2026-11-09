import { eq } from 'drizzle-orm'
import { events } from './schema/event'
import type { Executor } from './client'

/**
 * Checks a transaction's `eventId` (docs/features/event.md rule 3). It reads the events table,
 * which the transaction feature can't import, so it lives here (like `debt-link`).
 */
export type EventLink =
  /** The owner's live event of the same profile (closed ones too). */
  | { status: 'ok' }
  /** No live event of this owner (deleted, never synced, someone else's). */
  | { status: 'gone' }
  | { status: 'otherProfile' }

export const checkEventLink = async (
  executor: Executor,
  userId: string,
  eventId: string,
  profileId: string
): Promise<EventLink> => {
  const event = (
    await executor
      .select({ userId: events.userId, profileId: events.profileId, deletedAt: events.deletedAt })
      .from(events)
      .where(eq(events.id, eventId))
  ).at(0)
  if (!event || event.userId !== userId || event.deletedAt !== null) {
    return { status: 'gone' }
  }
  return event.profileId === profileId ? { status: 'ok' } : { status: 'otherProfile' }
}
