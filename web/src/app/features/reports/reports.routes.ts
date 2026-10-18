import type { Routes } from '@angular/router'

export default [
  {
    path: '',
    title: 'title.reports',
    loadComponent: async () =>
      import('./pages/reports-page/reports-page').then((m) => m.ReportsPage),
  },
] satisfies Routes
