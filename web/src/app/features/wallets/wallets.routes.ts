import type { Routes } from '@angular/router'

export default [
  {
    path: '',
    title: 'กระเป๋าเงิน',
    loadComponent: async () =>
      import('./pages/wallets-page/wallets-page').then((m) => m.WalletsPage),
  },
] satisfies Routes
