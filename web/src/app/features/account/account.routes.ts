import type { Routes } from '@angular/router'

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
    loadComponent: async () => import('./pages/phone-page/phone-page').then((m) => m.PhonePage),
  },
  {
    path: 'password',
    title: 'title.password',
    loadComponent: async () =>
      import('./pages/password-page/password-page').then((m) => m.PasswordPage),
  },
  {
    // Turn offline on (choose a PIN) or change the PIN (offline-sync rules 1 and 4).
    path: 'pin',
    title: 'title.pin',
    loadComponent: async () => import('./pages/pin-page/pin-page').then((m) => m.PinPage),
  },
  {
    // Dev only, temporary (offline-sync → Web screens): removed at #6.
    path: 'sync-test',
    title: 'title.syncTest',
    loadComponent: async () =>
      import('./pages/sync-test-page/sync-test-page').then((m) => m.SyncTestPage),
  },
] satisfies Routes
