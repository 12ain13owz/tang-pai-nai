import { inject } from '@angular/core'
import { Router } from '@angular/router'
import type { Routes } from '@angular/router'
import { authGuard, guestGuard } from '@/core/auth'
import { lockGuard, otherTabGuard, trustGuard } from '@/core/offline'
import { AuthFlowStore } from './auth-flow.store'
import { AuthLayout } from './components/auth-layout'

/** The code screen only makes sense right after asking for a code (by email or SMS). */
const hasPendingSignIn = () => {
  const { email, phone } = inject(AuthFlowStore).pending()
  return email || phone ? true : inject(Router).parseUrl('/auth/sign-in')
}

export default [
  {
    path: '',
    component: AuthLayout,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'sign-in' },
      {
        path: 'sign-in',
        title: 'title.signIn',
        canActivate: [guestGuard],
        loadComponent: async () =>
          import('./pages/sign-in-page/sign-in-page').then((m) => m.SignInPage),
      },
      {
        path: 'code',
        title: 'title.enterCode',
        canActivate: [guestGuard, hasPendingSignIn],
        loadComponent: async () =>
          import('./pages/enter-code-page/enter-code-page').then((m) => m.EnterCodePage),
      },
      {
        path: 'password',
        title: 'title.passwordSignIn',
        canActivate: [guestGuard],
        loadComponent: async () =>
          import('./pages/password-sign-in-page/password-sign-in-page').then(
            (m) => m.PasswordSignInPage
          ),
      },
      {
        path: 'phone',
        title: 'title.phoneSignIn',
        canActivate: [guestGuard],
        loadComponent: async () =>
          import('./pages/phone-sign-in-page/phone-sign-in-page').then((m) => m.PhoneSignInPage),
      },
      {
        // Not guest-only: a link opened while signed in signs in as that email.
        path: 'link',
        title: 'title.signIn',
        loadComponent: async () =>
          import('./pages/magic-link-page/magic-link-page').then((m) => m.MagicLinkPage),
      },
      {
        // Back from Google (rule 14). Not guest-only, like the magic link.
        path: 'callback',
        title: 'title.signIn',
        loadComponent: async () =>
          import('./pages/google-callback-page/google-callback-page').then(
            (m) => m.GoogleCallbackPage
          ),
      },
      {
        // Right after a sign-in on an untrusted device (offline-sync rule 1).
        path: 'trust',
        title: 'title.trust',
        canActivate: [authGuard, trustGuard],
        loadComponent: async () => import('./pages/trust-page/trust-page').then((m) => m.TrustPage),
      },
      {
        // A trusted device before its PIN (offline-sync rules 2–3).
        path: 'lock',
        title: 'title.lock',
        canActivate: [lockGuard],
        loadComponent: async () => import('./pages/lock-page/lock-page').then((m) => m.LockPage),
      },
      {
        // One tab at a time (offline-sync rule 2).
        path: 'tab',
        title: 'title.otherTab',
        canActivate: [otherTabGuard],
        loadComponent: async () =>
          import('./pages/other-tab-page/other-tab-page').then((m) => m.OtherTabPage),
      },
    ],
  },
] satisfies Routes
