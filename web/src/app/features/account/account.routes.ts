import { inject } from '@angular/core'
import { Router } from '@angular/router'
import type { Routes } from '@angular/router'
import { PHONE_FEATURE } from '@/core/auth'

export default [
  {
    path: '',
    title: 'title.account',
    loadComponent: async () =>
      import('./pages/account-page/account-page').then((m) => m.AccountPage),
  },
  {
    path: 'security',
    title: 'title.security',
    loadComponent: async () =>
      import('./pages/security-page/security-page').then((m) => m.SecurityPage),
  },
  {
    path: 'phone',
    title: 'title.phone',
    // Held back with the rest of phone (`PHONE_FEATURE`): an old link lands on Security.
    canActivate: [
      () => inject(PHONE_FEATURE) || inject(Router).createUrlTree(['/account/security']),
    ],
    loadComponent: async () => import('./pages/phone-page/phone-page').then((m) => m.PhonePage),
  },
  {
    path: 'password',
    title: 'title.password',
    loadComponent: async () =>
      import('./pages/password-page/password-page').then((m) => m.PasswordPage),
  },
  {
    path: 'profiles',
    title: 'title.profiles',
    loadComponent: async () =>
      import('./pages/profiles-page/profiles-page').then((m) => m.ProfilesPage),
  },
  {
    path: 'categories',
    title: 'title.categories',
    loadComponent: async () =>
      import('./pages/categories-page/categories-page').then((m) => m.CategoriesPage),
  },
  {
    path: 'sharing',
    title: 'title.sharing',
    loadComponent: async () =>
      import('./pages/sharing-page/sharing-page').then((m) => m.SharingPage),
  },
  {
    path: 'recurring',
    title: 'title.recurring',
    loadComponent: async () =>
      import('./pages/recurring-page/recurring-page').then((m) => m.RecurringPage),
  },
  {
    path: 'export',
    title: 'title.export',
    loadComponent: async () => import('./pages/export-page/export-page').then((m) => m.ExportPage),
  },
  {
    path: 'appearance',
    title: 'title.appearance',
    loadComponent: async () =>
      import('./pages/appearance-page/appearance-page').then((m) => m.AppearancePage),
  },
  {
    path: 'device',
    title: 'title.device',
    loadComponent: async () => import('./pages/device-page/device-page').then((m) => m.DevicePage),
  },
  {
    // Turn the PIN on, change it, or (`?off=1`) turn it off (offline-sync rules 2 and 4).
    path: 'pin',
    title: 'title.pin',
    loadComponent: async () => import('./pages/pin-page/pin-page').then((m) => m.PinPage),
  },
] satisfies Routes
