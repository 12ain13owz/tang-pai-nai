import type { Routes } from '@angular/router'
import { setUpDebts } from '@/core/debt/debt-testing'

/**
 * `setUpDebts`' test database and real services (profile `p1`, wallets `cash` / `bank`,
 * categories `shop` / `interest` / `gift`) plus `event`, which puts a pulled event (spec helper).
 */
export const setUpEvents = async (today = '2026-11-09', routes: Routes = []) => {
  const setup = await setUpDebts(today, routes)
  const event = (id: string, extra: object = {}) =>
    setup.pulled('events', {
      id,
      profileId: 'p1',
      name: id,
      icon: 'lucidePlane',
      color: '#0e7490',
      startOn: '2026-11-07',
      endOn: '2026-11-12',
      isClosed: false,
      ...extra,
    })
  return { ...setup, event }
}
