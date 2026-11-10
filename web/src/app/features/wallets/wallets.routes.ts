import type { Routes } from '@angular/router'

export default [
  {
    path: '',
    title: 'title.wallets',
    loadComponent: async () =>
      import('./pages/wallets-page/wallets-page').then((m) => m.WalletsPage),
  },
] satisfies Routes
