import { Component } from '@angular/core'
import { RouterLink, RouterLinkActive } from '@angular/router'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideChartPie,
  lucideCircleUser,
  lucidePlus,
  lucideReceiptText,
  lucideWallet,
} from '@ng-icons/lucide'

interface Tab {
  path: string
  label: string
  icon: string
  exact: boolean
}

/** Money Lover style bar: two tabs, a raised ➕ (add transaction), two tabs. */
@Component({
  selector: 'app-bottom-tab-bar',
  imports: [RouterLink, RouterLinkActive, NgIcon],
  providers: [
    provideIcons({ lucideChartPie, lucideCircleUser, lucidePlus, lucideReceiptText, lucideWallet }),
  ],
  template: `
    <nav
      aria-label="เมนูหลัก"
      class="mx-auto grid h-16 max-w-[480px] grid-cols-5 items-stretch border-t border-border bg-background"
    >
      @for (tab of tabs; track tab.path) {
        @if ($index === 2) {
          <div class="flex items-center justify-center">
            <a
              routerLink="/transactions/new"
              aria-label="เพิ่มธุรกรรม"
              class="-mt-6 flex size-14 items-center justify-center rounded-full bg-primary text-2xl text-primary-foreground shadow-lg ring-4 ring-background focus-visible:ring-ring focus-visible:outline-none"
            >
              <ng-icon name="lucidePlus" aria-hidden="true" />
            </a>
          </div>
        }
        <a
          [routerLink]="tab.path"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
          [routerLinkActiveOptions]="{ exact: tab.exact }"
          class="group flex flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground focus-visible:outline-none [&.active]:font-medium [&.active]:text-foreground"
        >
          <span
            class="flex h-7 w-12 items-center justify-center rounded-full text-xl group-focus-visible:ring-2 group-focus-visible:ring-ring group-[.active]:bg-muted"
          >
            <ng-icon [name]="tab.icon" aria-hidden="true" />
          </span>
          {{ tab.label }}
        </a>
      }
    </nav>
  `,
})
export class BottomTabBar {
  /** The ➕ sits between the 2nd and 3rd tab. */
  protected readonly tabs: readonly Tab[] = [
    // exact, so the ➕ page (/transactions/new) doesn't light up this tab
    { path: '/transactions', label: 'ธุรกรรม', icon: 'lucideReceiptText', exact: true },
    { path: '/wallets', label: 'กระเป๋า', icon: 'lucideWallet', exact: false },
    { path: '/reports', label: 'รายงาน', icon: 'lucideChartPie', exact: false },
    { path: '/account', label: 'บัญชีผู้ใช้', icon: 'lucideCircleUser', exact: false },
  ]
}
