import { InjectionToken } from '@angular/core'

/**
 * Whether the web offers phone at all (4.4b): the sign-in page's phone tab, Account › Security's
 * phone row and `/account/phone`. Off while the phone feature isn't finished: the code stays, and
 * nothing shows even when the API says SMS is on (`?with=phone` opens the email tab,
 * `/account/phone` goes to Security). Specs provide `true` to keep testing it.
 */
export const PHONE_FEATURE = new InjectionToken<boolean>('PHONE_FEATURE', {
  providedIn: 'root',
  factory: () => false,
})
