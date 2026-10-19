import type { Routes } from '@angular/router'

export default [
  {
    path: '',
    title: 'title.transactions',
    loadComponent: async () =>
      import('./pages/transactions-page/transactions-page').then((m) => m.TransactionsPage),
  },
  {
    path: 'new',
    title: 'title.transactionNew',
    loadComponent: async () =>
      import('./pages/transaction-new-page/transaction-new-page').then((m) => m.TransactionNewPage),
  },
] satisfies Routes
