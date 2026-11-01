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
    // Turn offline on (choose a PIN) or change the PIN (offline-sync rules 1 and 4).
    path: 'pin',
    title: 'title.pin',
    loadComponent: async () => import('./pages/pin-page/pin-page').then((m) => m.PinPage),
  },
] satisfies Routes
