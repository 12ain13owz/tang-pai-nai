import type { Routes } from '@angular/router'

export default [
  {
    path: '',
    title: 'title.transactions',
    loadComponent: async () =>
      import('./pages/transactions-page/transactions-page').then((m) => m.TransactionsPage),
  },
] satisfies Routes
