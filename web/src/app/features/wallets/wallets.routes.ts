import type { Routes } from '@angular/router'

export default [
  {
    path: '',
    title: 'title.wallets',
    loadComponent: async () =>
      import('./pages/wallets-page/wallets-page').then((m) => m.WalletsPage),
  },
  {
    // A wallet shared with me (sharing.md), read online; the title is the wallet's name.
    path: 'shared/:id',
    title: 'title.sharedWallet',
    loadComponent: async () =>
      import('./pages/shared-wallet-page/shared-wallet-page').then((m) => m.SharedWalletPage),
  },
] satisfies Routes
