import type { Routes } from '@angular/router'
import { shellGuard } from '@/core/offline'
import { AppShell } from '@/layout'

export const routes: Routes = [
  // Sign-in flow: full screen, outside the shell (no tab bar).
  {
    path: 'auth',
    loadChildren: async () => import('@/features/auth').then((m) => m.authRoutes),
  },
  {
    path: '',
    component: AppShell,
    canActivate: [shellGuard],
    canActivateChild: [shellGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'transactions' },
      {
        // Events / trips live under the Transactions tab (event.md Q6).
        path: 'transactions/events',
        loadChildren: async () => import('@/features/events').then((m) => m.eventsRoutes),
      },
      {
        path: 'transactions',
        loadChildren: async () =>
          import('@/features/transactions').then((m) => m.transactionsRoutes),
      },
      {
        // Debts live under the Wallets tab (debt.md Q9).
        path: 'wallets/debts',
        loadChildren: async () => import('@/features/debts').then((m) => m.debtsRoutes),
      },
      {
        path: 'wallets',
        loadChildren: async () => import('@/features/wallets').then((m) => m.walletsRoutes),
      },
      {
        path: 'reports',
        loadChildren: async () => import('@/features/reports').then((m) => m.reportsRoutes),
      },
      {
        path: 'account',
        loadChildren: async () => import('@/features/account').then((m) => m.accountRoutes),
      },
    ],
  },
  { path: '**', redirectTo: '' },
]
