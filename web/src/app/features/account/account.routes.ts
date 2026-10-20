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
    path: 'password',
    title: 'title.password',
    loadComponent: async () =>
      import('./pages/password-page/password-page').then((m) => m.PasswordPage),
  },
] satisfies Routes
