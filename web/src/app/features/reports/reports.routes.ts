import type { Routes } from '@angular/router'

export default [
  {
    path: '',
    title: 'title.reports',
    loadComponent: async () =>
      import('./pages/reports-page/reports-page').then((m) => m.ReportsPage),
  },
  {
    path: 'excluded',
    title: 'reports.excludedTitle',
    loadComponent: async () =>
      import('./pages/report-excluded-page/report-excluded-page').then((m) => m.ReportExcludedPage),
  },
  // A category's page (report.md Q5); `sub` is a sub-category's id, or `direct` for the money
  // saved on the parent itself (Q4). Its title is the category's name.
  {
    path: 'category/:id',
    title: 'title.reports',
    loadComponent: async () =>
      import('./pages/report-category-page/report-category-page').then((m) => m.ReportCategoryPage),
  },
  {
    path: 'category/:id/:sub',
    title: 'title.reports',
    loadComponent: async () =>
      import('./pages/report-category-page/report-category-page').then((m) => m.ReportCategoryPage),
  },
] satisfies Routes
