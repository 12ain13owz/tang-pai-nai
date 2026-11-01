import { Component, computed, inject, signal } from '@angular/core'
import { Router, RouterLink } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideChevronRight,
  lucideLogOut,
  lucidePalette,
  lucideShapes,
  lucideShieldCheck,
  lucideSmartphone,
  lucideUsers,
} from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { AuthService, AuthStore, SIGN_IN_URL } from '@/core/auth'
import { LanguageService } from '@/core/i18n'
import { OfflineService, SyncService } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import { DeviceStorageService } from '@/core/pwa'
import { ThemeService } from '@/core/theme'

/** A row of the account page: a page to go to, with a short line on what's there. */
interface AccountItem {
  link: string
  icon: string
  label: string
  hint: string
}

@Component({
  selector: 'app-account-page',
  imports: [TranslocoPipe, RouterLink, NgIcon, HlmButton, HlmSpinner],
  providers: [
    provideIcons({
      lucideChevronRight,
      lucideLogOut,
      lucidePalette,
      lucideShapes,
      lucideShieldCheck,
      lucideSmartphone,
      lucideUsers,
    }),
  ],
  template: `
    <div class="flex flex-col gap-6 p-4">
      @if (authStore.user(); as user) {
        <div class="flex items-center gap-3">
          <span
            class="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold"
            aria-hidden="true"
            >{{ initial(user.displayName) }}</span
          >
          <div class="flex min-w-0 flex-col">
            <p class="text-base font-semibold break-all">{{ user.displayName }}</p>
            <p class="text-sm break-all text-muted-foreground">{{ user.email }}</p>
          </div>
        </div>
      }
      @for (group of groups(); track group.key) {
        <section class="flex flex-col gap-3" [attr.aria-labelledby]="'account-' + group.key">
          <h2 [id]="'account-' + group.key" class="text-sm font-medium text-muted-foreground">
            {{ 'account.group.' + group.key | transloco }}
          </h2>
          <ul
            class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
          >
            @for (item of group.items; track item.link) {
              <li>
                <a
                  class="flex min-h-14 items-center gap-3 px-4 py-2 first:rounded-t-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  [routerLink]="item.link"
                >
                  <span
                    class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xl text-muted-foreground"
                    aria-hidden="true"
                  >
                    <ng-icon [name]="item.icon" />
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="text-base">{{ item.label | transloco }}</span>
                    <span class="truncate text-sm text-muted-foreground">{{ item.hint }}</span>
                  </span>
                  <ng-icon
                    name="lucideChevronRight"
                    size="20"
                    class="text-muted-foreground"
                    aria-hidden="true"
                  />
                </a>
              </li>
            }
          </ul>
        </section>
      }

      <section class="flex flex-col gap-3">
        <button
          hlmBtn
          variant="outline"
          type="button"
          class="h-11 w-full text-base"
          [disabled]="isSigningOut()"
          (click)="signOut(false)"
        >
          @if (isSigningOut()) {
            <hlm-spinner [aria-label]="'account.signingOut' | transloco" />
          } @else {
            <ng-icon name="lucideLogOut" aria-hidden="true" />
          }
          {{ 'account.signOut' | transloco }}
        </button>
        @if (unsynced() > 0) {
          <div
            class="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
          >
            <p class="text-sm">
              {{ 'account.signOutUnsynced' | transloco: { count: unsynced() } }}
            </p>
            <button
              hlmBtn
              variant="destructive"
              type="button"
              class="h-11 w-full text-base"
              [disabled]="isSigningOut()"
              (click)="signOut(true)"
            >
              {{ 'account.signOutUnsyncedConfirm' | transloco }}
            </button>
            <button
              hlmBtn
              variant="outline"
              type="button"
              class="h-11 w-full"
              (click)="unsynced.set(0)"
            >
              {{ 'account.cancel' | transloco }}
            </button>
          </div>
        }
        @if (signOutFailed()) {
          <p role="alert" class="text-center text-sm text-destructive">
            {{ 'account.signOutFailed' | transloco }}
          </p>
        }
      </section>
    </div>
  `,
})
/**
 * The Account tab (owner's choice A1 in #7): who is signed in, then grouped rows that each open a
 * page (my data, account and security, settings), and sign-out.
 */
export class AccountPage {
  protected profileService = inject(ProfileService)
  private transloco = inject(TranslocoService)
  private themeService = inject(ThemeService)
  private languageService = inject(LanguageService)
  private deviceStorageService = inject(DeviceStorageService)
  private router = inject(Router)
  private authService = inject(AuthService)
  private offlineService = inject(OfflineService)
  protected syncService = inject(SyncService)
  protected authStore = inject(AuthStore)

  protected isSigningOut = signal(false)
  protected signOutFailed = signal(false)
  /** Ops that would be lost by signing out now (still pending or rejected after a push). */
  protected unsynced = signal(0)

  protected groups = computed<{ key: string; items: AccountItem[] }[]>(() => {
    this.languageService.language() // re-translate on a language switch
    const t = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate(key, params)
    const profile = this.profileService.current()
    const count = this.profileService.profiles().length
    const persisted = this.deviceStorageService.isPersisted()
    return [
      {
        key: 'data',
        items: [
          {
            link: '/account/profiles',
            icon: 'lucideUsers',
            label: 'account.profiles',
            hint: profile
              ? t('account.profilesHint', { name: profile.name, count })
              : t('account.profilesNone'),
          },
          {
            link: '/account/categories',
            icon: 'lucideShapes',
            label: 'account.categories',
            hint: profile
              ? t('account.categoriesHint', { name: profile.name })
              : t('account.profilesNone'),
          },
        ],
      },
      {
        key: 'security',
        items: [
          {
            link: '/account/security',
            icon: 'lucideShieldCheck',
            label: 'account.security',
            hint: t('account.securityHint'),
          },
        ],
      },
      {
        key: 'settings',
        items: [
          {
            link: '/account/appearance',
            icon: 'lucidePalette',
            label: 'account.appearance',
            hint: [
              this.languageService.language().label,
              t(`account.mode${capitalize(this.themeService.preference())}`),
              this.themeService.palette().label,
            ].join(' · '),
          },
          {
            link: '/account/device',
            icon: 'lucideSmartphone',
            label: 'account.device',
            hint: [
              t(
                this.deviceStorageService.isInstalled()
                  ? 'account.installedYes'
                  : 'account.installedNo'
              ),
              t(
                persisted === true
                  ? 'account.persistentOnHint'
                  : persisted === false
                    ? 'account.persistentOffHint'
                    : 'account.persistentUnknownHint'
              ),
            ].join(' · '),
          },
        ],
      },
    ]
  })

  constructor() {
    // Fresh profile; the one from sign-in is shown meanwhile, and offline it simply stays.
    this.authService.loadMe().catch(() => undefined)
  }

  /** The avatar's letter: the name's first character (Thai or Latin). */
  protected initial(name: string): string {
    return [...name.trim()].at(0)?.toUpperCase() ?? ''
  }

  protected async signOut(confirmed: boolean): Promise<void> {
    this.isSigningOut.set(true)
    this.signOutFailed.set(false)
    try {
      // Rule 7: push the outbox first, and ask before losing what couldn't be pushed.
      const unsynced = await this.syncService.flush()
      if (unsynced > 0 && !confirmed) {
        this.unsynced.set(unsynced)
        return
      }
      this.unsynced.set(0)
      await this.authService.signOut()
      // Rule 7: this device forgets the signed-out user's data.
      await this.offlineService.wipe()
      await this.router.navigateByUrl(SIGN_IN_URL, { replaceUrl: true })
    } catch {
      this.signOutFailed.set(true)
    } finally {
      this.isSigningOut.set(false)
    }
  }
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
