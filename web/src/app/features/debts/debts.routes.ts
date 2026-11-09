import type { Routes } from '@angular/router'

export default [
  {
    path: '',
    title: 'title.debts',
    loadComponent: async () => import('./pages/debts-page/debts-page').then((m) => m.DebtsPage),
  },
  // A debt's page; its title is the person's name.
  {
    path: ':id',
    title: 'title.debts',
    loadComponent: async () => import('./pages/debt-page/debt-page').then((m) => m.DebtPage),
  },
] satisfies Routes
