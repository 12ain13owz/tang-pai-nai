import type { Routes } from '@angular/router'
import { authGuard } from '@/core/auth'
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
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'transactions' },
      {
        path: 'transactions',
        loadChildren: async () =>
          import('@/features/transactions').then((m) => m.transactionsRoutes),
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
