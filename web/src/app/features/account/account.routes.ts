import type { Routes } from '@angular/router'

export default [
  {
    path: '',
    title: 'title.account',
    loadComponent: async () =>
      import('./pages/account-page/account-page').then((m) => m.AccountPage),
  },
] satisfies Routes
