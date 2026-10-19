import { inject } from '@angular/core'
import { Router } from '@angular/router'
import type { Routes } from '@angular/router'
import { guestGuard } from '@/core/auth'
import { AuthFlowStore } from './auth-flow.store'
import { AuthLayout } from './components/auth-layout'

/** The code screen only makes sense right after asking for a code. */
const hasPendingEmail = () =>
  inject(AuthFlowStore).pending().email ? true : inject(Router).parseUrl('/auth/sign-in')

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
        canActivate: [guestGuard, hasPendingEmail],
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
    ],
  },
] satisfies Routes
