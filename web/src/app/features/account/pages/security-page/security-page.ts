import { Location, NgTemplateOutlet } from '@angular/common'
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
} from '@angular/core'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideArrowLeft,
  lucideChevronRight,
  lucideCloudOff,
  lucideKeyRound,
  lucideLockKeyhole,
  lucidePhone,
  lucideMonitor,
  lucideSmartphone,
  lucideTablet,
} from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { toApiError } from '@/core/api'
import { authErrorMessage, AuthService, AuthStore, formatThaiMobile } from '@/core/auth'
import type { AuthDeviceSession, GoogleLinkFailure, UiMessage } from '@/core/auth'
import { LanguageService } from '@/core/i18n'
import { NetworkStatusService } from '@/core/network'
import { OfflineService } from '@/core/offline'
import { ReauthStep } from '@/features/account/components/reauth-step'
import { deviceLabel } from '@/features/account/device-label'
import type { DeviceLabel } from '@/features/account/device-label'
import { ReauthFlow } from '@/features/account/reauth-flow'
import { GoogleLogo } from '@/shared/components/brand'

/** What waits for "confirm it's you" (auth spec rules 29–30). */
type GoogleAction = 'link' | 'unlink'

/** What the user is asked to confirm before it happens (none of these can be undone). */
type Confirming =
  | { kind: 'unlink' }
  | { kind: 'revoke'; id: string }
  | { kind: 'revokeOthers' }
  | { kind: 'offlineOff' }

interface DeviceRow {
  session: AuthDeviceSession
  label: DeviceLabel
  signedIn: string
  /** `null` under a minute ago ("just now"). */
  lastActive: string | null
}

const LINK_FAILURES: Record<GoogleLinkFailure, string> = {
  google_in_use: 'security.googleInUse',
  already_linked: 'security.googleAlreadyLinked',
  disabled: 'auth.userDisabled',
  rate_limited: 'auth.googleRateLimited',
  failed: 'security.googleLinkFailed',
}

const isLinkFailure = (value: string): value is GoogleLinkFailure =>
  Object.hasOwn(LINK_FAILURES, value)

const DEVICE_ICONS: Record<DeviceLabel['kind'], string> = {
  phone: 'lucideSmartphone',
  tablet: 'lucideTablet',
  computer: 'lucideMonitor',
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Account › Security (auth spec rules 28–30, 4.4a): the ways to sign in (password, Google) and
 * the signed-in devices, both online only, and this device's offline mode and PIN (offline-sync
 * rules 1 and 4, 4a.1), which work offline too.
 */
@Component({
  selector: 'app-security-page',
  imports: [
    NgTemplateOutlet,
    TranslocoPipe,
    RouterLink,
    NgIcon,
    HlmButton,
    HlmSpinner,
    GoogleLogo,
    ReauthStep,
  ],
  providers: [
    provideIcons({
      lucideArrowLeft,
      lucideChevronRight,
      lucideCloudOff,
      lucideKeyRound,
      lucideLockKeyhole,
      lucidePhone,
      lucideMonitor,
      lucideSmartphone,
      lucideTablet,
    }),
    ReauthFlow,
  ],
  template: `
    <div class="flex flex-col gap-6 p-4">
      <button hlmBtn variant="ghost" type="button" class="-ms-3 h-11 self-start" (click)="back()">
        <ng-icon name="lucideArrowLeft" aria-hidden="true" />
        {{ 'title.account' | transloco }}
      </button>

      @if (!networkStatusService.isOnline()) {
        <p role="status" class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {{ 'security.offline' | transloco }}
        </p>
      }

      @if (authStore.user(); as user) {
        <section class="flex flex-col gap-3" aria-labelledby="ways-heading">
          <h2 id="ways-heading" class="text-sm font-medium text-muted-foreground">
            {{ 'security.waysHeading' | transloco }}
          </h2>
          <div
            class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
          >
            <a routerLink="/account/password" class="flex min-h-14 items-center gap-3 px-4 py-3">
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xl text-muted-foreground"
                aria-hidden="true"
              >
                <ng-icon name="lucideKeyRound" />
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-base">{{ 'account.password' | transloco }}</span>
                <span class="text-sm text-muted-foreground">
                  {{
                    (user.hasPassword ? 'account.passwordSet' : 'account.passwordUnset') | transloco
                  }}
                </span>
              </span>
              <ng-icon
                name="lucideChevronRight"
                size="20"
                class="text-muted-foreground"
                aria-hidden="true"
              />
            </a>

            @if (phoneEnabled()) {
              <a routerLink="/account/phone" class="flex min-h-14 items-center gap-3 px-4 py-3">
                <ng-container [ngTemplateOutlet]="phoneRow" />
                <ng-icon
                  name="lucideChevronRight"
                  size="20"
                  class="text-muted-foreground"
                  aria-hidden="true"
                />
              </a>
            } @else if (phone()) {
              <!-- SMS is off: a saved number still shows, read-only (rule 21). -->
              <div class="flex min-h-14 items-center gap-3 px-4 py-3">
                <ng-container [ngTemplateOutlet]="phoneRow" />
              </div>
            }
            <ng-template #phoneRow>
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xl text-muted-foreground"
                aria-hidden="true"
              >
                <ng-icon name="lucidePhone" />
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-base">{{ 'account.phone' | transloco }}</span>
                <span class="text-sm text-muted-foreground tabular-nums">
                  {{ phone() ?? ('account.phoneNotAdded' | transloco) }}
                </span>
              </span>
            </ng-template>

            @if (googleEnabled() || google()) {
              <div class="flex min-h-14 items-center gap-3 px-4 py-3">
                <span
                  class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted"
                  aria-hidden="true"
                >
                  <app-google-logo />
                </span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="text-base">{{ 'account.google' | transloco }}</span>
                  <span class="truncate text-sm text-muted-foreground">
                    @if (google(); as identity) {
                      {{ identity.email }}
                    } @else {
                      {{ 'account.googleNotLinked' | transloco }}
                    }
                  </span>
                </span>
                @if (google()) {
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    type="button"
                    class="h-10 shrink-0 px-3"
                    [disabled]="isBusy() || !networkStatusService.isOnline()"
                    (click)="ask({ kind: 'unlink' })"
                  >
                    {{ 'security.unlink' | transloco }}
                  </button>
                } @else {
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    type="button"
                    class="h-10 shrink-0 px-3"
                    [disabled]="isBusy() || !networkStatusService.isOnline() || !googleEnabled()"
                    (click)="runGoogle('link')"
                  >
                    @if (busyWith() === 'link') {
                      <hlm-spinner [aria-label]="'security.linking' | transloco" />
                    }
                    {{ 'security.link' | transloco }}
                  </button>
                }
              </div>
            }
          </div>

          @if (googleError(); as message) {
            <p role="alert" class="-mt-1 text-sm text-destructive">
              {{ message.key | transloco: message.params }}
            </p>
          }

          @if (confirming()?.kind === 'unlink' && !reauth.pending()) {
            <div
              class="flex scroll-mb-24 flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
              data-confirm
            >
              <p class="text-sm">{{ 'security.unlinkConfirmText' | transloco }}</p>
              <button
                hlmBtn
                variant="destructive"
                type="button"
                class="h-11 w-full text-base"
                [disabled]="isBusy() || !networkStatusService.isOnline()"
                (click)="runGoogle('unlink')"
              >
                @if (busyWith() === 'unlink') {
                  <hlm-spinner [aria-label]="'security.unlinking' | transloco" />
                }
                {{ 'security.unlinkConfirm' | transloco }}
              </button>
              <button
                hlmBtn
                variant="outline"
                type="button"
                class="h-11 w-full"
                [disabled]="isBusy()"
                (click)="confirming.set(null)"
              >
                {{ 'account.cancel' | transloco }}
              </button>
            </div>
          }

          @if (reauth.pending(); as action) {
            <app-reauth-step
              [email]="user.email"
              [hasPassword]="user.hasPassword"
              [method]="reauth.method()"
              [codeSent]="reauth.codeSent()"
              [secondsLeft]="reauth.secondsLeft()"
              [isProcessing]="isBusy()"
              [error]="reauth.error()"
              (passwordSubmitted)="runGoogle(action, $event)"
              (sendCode)="reauth.sendCode()"
              (codeSubmitted)="confirmWithCode(action, $event)"
              (methodChange)="reauth.switchMethod($event)"
              (cancelled)="cancelGoogle()"
            />
          }
        </section>
      }

      <section class="flex flex-col gap-3" aria-labelledby="device-heading">
        <h2 id="device-heading" class="text-sm font-medium text-muted-foreground">
          {{ 'security.deviceHeading' | transloco }}
        </h2>
        <div
          class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
        >
          <div class="flex min-h-14 items-center gap-3 px-4 py-3">
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xl text-muted-foreground"
              aria-hidden="true"
            >
              <ng-icon name="lucideCloudOff" />
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="text-base">{{ 'security.offlineMode' | transloco }}</span>
              <span class="text-sm text-muted-foreground">
                {{
                  (offlineService.isTrusted() ? 'security.offlineOn' : 'security.offlineOff')
                    | transloco
                }}
              </span>
            </span>
            @if (offlineService.isTrusted()) {
              @if (confirming()?.kind !== 'offlineOff') {
                <button
                  hlmBtn
                  variant="outline"
                  size="sm"
                  type="button"
                  class="h-10 shrink-0 px-3"
                  [disabled]="isBusy()"
                  (click)="ask({ kind: 'offlineOff' })"
                >
                  {{ 'security.turnOff' | transloco }}
                </button>
              }
            } @else {
              <a
                hlmBtn
                variant="outline"
                size="sm"
                routerLink="/account/pin"
                class="h-10 shrink-0 px-3"
              >
                {{ 'security.turnOn' | transloco }}
              </a>
            }
          </div>
          @if (offlineService.isTrusted()) {
            <a routerLink="/account/pin" class="flex min-h-14 items-center gap-3 px-4 py-3">
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xl text-muted-foreground"
                aria-hidden="true"
              >
                <ng-icon name="lucideLockKeyhole" />
              </span>
              <span class="flex-1 text-base">{{ 'security.changePin' | transloco }}</span>
              <ng-icon
                name="lucideChevronRight"
                size="20"
                class="text-muted-foreground"
                aria-hidden="true"
              />
            </a>
          }
        </div>

        @if (confirming()?.kind === 'offlineOff') {
          <div
            class="flex scroll-mb-24 flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
            data-confirm
          >
            <p class="text-sm">{{ 'security.offlineOffConfirmText' | transloco }}</p>
            <button
              hlmBtn
              variant="destructive"
              type="button"
              class="h-11 w-full text-base"
              [disabled]="isBusy()"
              (click)="turnOfflineOff()"
            >
              {{ 'security.offlineOffConfirm' | transloco }}
            </button>
            <button
              hlmBtn
              variant="outline"
              type="button"
              class="h-11 w-full"
              (click)="confirming.set(null)"
            >
              {{ 'account.cancel' | transloco }}
            </button>
          </div>
        }
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="devices-heading">
        <h2 id="devices-heading" class="text-sm font-medium text-muted-foreground">
          {{ 'security.devicesHeading' | transloco }}
        </h2>

        @if (devices(); as rows) {
          <ul
            class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
          >
            @for (row of rows; track row.session.id) {
              <li
                class="flex scroll-mb-24 flex-col gap-3 px-4 py-3"
                [attr.data-confirm]="isConfirmingRevoke(row.session.id) ? '' : null"
              >
                <div class="flex min-h-10 items-center gap-3">
                  <span
                    class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xl text-muted-foreground"
                    aria-hidden="true"
                  >
                    <ng-icon [name]="deviceIcon(row.label)" />
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-base">
                      {{ row.label.name ?? ('security.unknownDevice' | transloco) }}
                    </span>
                    <span class="text-sm text-muted-foreground">
                      {{ 'security.signedInOn' | transloco: { date: row.signedIn } }}
                    </span>
                    <span class="text-sm text-muted-foreground">
                      @if (row.session.current) {
                        {{ 'security.activeNow' | transloco }}
                      } @else if (row.lastActive === null) {
                        {{ 'security.lastActiveJustNow' | transloco }}
                      } @else {
                        {{ 'security.lastActive' | transloco }}
                        <span class="whitespace-nowrap">{{ row.lastActive }}</span>
                      }
                    </span>
                  </span>
                  @if (row.session.current) {
                    <span
                      class="shrink-0 rounded-full bg-brand/15 px-2.5 py-1 text-xs font-medium text-foreground"
                    >
                      {{ 'security.thisDevice' | transloco }}
                    </span>
                  } @else if (!isConfirmingRevoke(row.session.id)) {
                    <button
                      hlmBtn
                      variant="outline"
                      size="sm"
                      type="button"
                      class="h-10 shrink-0 px-3"
                      [disabled]="isBusy() || !networkStatusService.isOnline()"
                      (click)="ask({ kind: 'revoke', id: row.session.id })"
                    >
                      {{ 'security.signOutDevice' | transloco }}
                    </button>
                  }
                </div>
                @if (isConfirmingRevoke(row.session.id)) {
                  <p class="text-sm">{{ 'security.signOutDeviceConfirmText' | transloco }}</p>
                  <div class="flex gap-3">
                    <button
                      hlmBtn
                      variant="outline"
                      type="button"
                      class="h-11 flex-1"
                      [disabled]="isBusy()"
                      (click)="confirming.set(null)"
                    >
                      {{ 'account.cancel' | transloco }}
                    </button>
                    <button
                      hlmBtn
                      variant="destructive"
                      type="button"
                      class="h-11 flex-1"
                      [disabled]="isBusy() || !networkStatusService.isOnline()"
                      (click)="revoke(row.session.id)"
                    >
                      @if (busyWith() === 'revoke') {
                        <hlm-spinner [aria-label]="'account.signingOut' | transloco" />
                      }
                      {{ 'security.signOutDevice' | transloco }}
                    </button>
                  </div>
                }
              </li>
            }
          </ul>

          @if (devicesError(); as message) {
            <p role="alert" class="-mt-1 text-sm text-destructive">
              {{ message.key | transloco: message.params }}
            </p>
          }

          @if (otherCount() > 0) {
            @if (confirming()?.kind === 'revokeOthers') {
              <div
                class="flex scroll-mb-24 flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
                data-confirm
              >
                <p class="text-sm">{{ 'security.signOutOthersConfirmText' | transloco }}</p>
                <button
                  hlmBtn
                  variant="destructive"
                  type="button"
                  class="h-11 w-full text-base"
                  [disabled]="isBusy() || !networkStatusService.isOnline()"
                  (click)="revokeOthers()"
                >
                  @if (busyWith() === 'revokeOthers') {
                    <hlm-spinner [aria-label]="'account.signingOut' | transloco" />
                  }
                  {{ 'security.signOutOthers' | transloco }}
                </button>
                <button
                  hlmBtn
                  variant="outline"
                  type="button"
                  class="h-11 w-full"
                  [disabled]="isBusy()"
                  (click)="confirming.set(null)"
                >
                  {{ 'account.cancel' | transloco }}
                </button>
              </div>
            } @else {
              <button
                hlmBtn
                variant="outline"
                type="button"
                class="h-11 w-full text-base"
                [disabled]="isBusy() || !networkStatusService.isOnline()"
                (click)="ask({ kind: 'revokeOthers' })"
              >
                {{ 'security.signOutOthers' | transloco }}
              </button>
            }
          }
        } @else if (devicesError(); as message) {
          <div class="flex flex-col items-start gap-2">
            <p role="alert" class="text-sm text-destructive">
              {{ message.key | transloco: message.params }}
            </p>
            <button
              hlmBtn
              variant="outline"
              type="button"
              class="h-11"
              [disabled]="!networkStatusService.isOnline()"
              (click)="loadDevices()"
            >
              {{ 'security.retry' | transloco }}
            </button>
          </div>
        } @else {
          <!-- An online-only list: a skeleton while it loads (DESIGN.md §6 Loading). -->
          <div
            class="divide-y divide-border rounded-xl border border-border bg-card"
            [attr.aria-label]="'security.loadingDevices' | transloco"
            role="status"
          >
            @for (item of [1, 2]; track item) {
              <div class="flex min-h-16 items-center gap-3 px-4 py-3" aria-hidden="true">
                <span class="size-10 shrink-0 animate-pulse rounded-full bg-muted"></span>
                <span class="flex flex-1 flex-col gap-2">
                  <span class="h-4 w-32 animate-pulse rounded bg-muted"></span>
                  <span class="h-3 w-48 animate-pulse rounded bg-muted"></span>
                </span>
              </div>
            }
          </div>
        }
      </section>
    </div>
  `,
})
export class SecurityPage {
  private router = inject(Router)
  private location = inject(Location)
  private host = inject<ElementRef<HTMLElement>>(ElementRef)
  private injector = inject(Injector)
  private transloco = inject(TranslocoService)
  private authService = inject(AuthService)
  private languageService = inject(LanguageService)
  protected authStore = inject(AuthStore)
  protected networkStatusService = inject(NetworkStatusService)
  protected offlineService = inject(OfflineService)
  protected reauth = inject(ReauthFlow<GoogleAction>)

  protected googleEnabled = signal(false)
  protected phoneEnabled = signal(false)
  protected phone = computed(() => {
    const phone = this.authStore.user()?.phone
    return phone ? formatThaiMobile(phone) : null
  })
  // Google is the only provider, linked at most once per user (rule 29).
  protected google = computed(() => this.authStore.user()?.identities.at(0) ?? null)
  protected googleError = signal<UiMessage | null>(null)

  private sessions = signal<AuthDeviceSession[] | null>(null)
  protected devicesError = signal<UiMessage | null>(null)
  protected devices = computed(() => {
    const sessions = this.sessions()
    return sessions ? sessions.map((session) => this.toRow(session)) : null
  })
  protected otherCount = computed(
    () => this.sessions()?.filter((session) => !session.current).length ?? 0
  )

  protected confirming = signal<Confirming | null>(null)
  /** The action in flight, for its spinner; every button waits while one runs. */
  protected busyWith = signal<GoogleAction | 'revoke' | 'revokeOthers' | null>(null)
  protected isBusy = computed(() => this.busyWith() !== null || this.reauth.isBusy())

  constructor() {
    const params = inject(ActivatedRoute).snapshot.queryParamMap
    const linked = params.get('linked') === 'google'
    const error = params.get('error')
    if (linked || error) {
      // A reload must not replay the outcome of the Google round trip.
      this.location.replaceState('/account/security')
    }
    if (linked) {
      toast.success(this.transloco.translate('security.googleLinked'))
    }
    if (error) {
      this.googleError.set({
        key: isLinkFailure(error) ? LINK_FAILURES[error] : 'security.googleLinkFailed',
      })
    }

    // Fresh profile (identities may have just changed); offline, the one in memory stays.
    this.authService.loadMe().catch(() => undefined)
    void this.authService.providers().then((providers) => {
      this.googleEnabled.set(providers.google)
      this.phoneEnabled.set(providers.phone)
    })
    void this.loadDevices()
  }

  protected async loadDevices(): Promise<void> {
    this.devicesError.set(null)
    try {
      this.sessions.set(await this.authService.sessions())
    } catch (error) {
      this.devicesError.set(authErrorMessage(toApiError(error), 'security.devicesFailed'))
    }
  }

  protected ask(confirming: Confirming): void {
    this.googleError.set(null)
    this.devicesError.set(null)
    this.confirming.set(confirming)
    // The question opens under its row and may land behind the tab bar (hence `scroll-mb-24`):
    // bring its buttons up.
    afterNextRender(
      () => {
        this.host.nativeElement
          .querySelector('[data-confirm]')
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      },
      { injector: this.injector }
    )
  }

  protected isConfirmingRevoke(id: string): boolean {
    const confirming = this.confirming()
    return confirming?.kind === 'revoke' && confirming.id === id
  }

  /** Link or unlink; on `REAUTH_REQUIRED` the confirm step shows and sends it again (rule 13). */
  protected async runGoogle(action: GoogleAction, currentPassword?: string): Promise<void> {
    this.busyWith.set(action)
    this.googleError.set(null)
    this.reauth.clearError()
    const lang = this.languageService.language().id
    try {
      if (action === 'link') {
        // On success the browser leaves for Google; the spinner stays until it does.
        await this.authService.linkGoogle(lang, currentPassword)
        return
      }
      await this.authService.unlinkGoogle(lang, currentPassword)
      this.reauth.close()
      this.confirming.set(null)
      toast.success(this.transloco.translate('security.unlinked'))
    } catch (error) {
      const apiError = toApiError(error)
      if (!this.reauth.refused(action, apiError, this.authStore.user()?.hasPassword ?? false)) {
        this.confirming.set(null)
        const fallback = action === 'link' ? 'security.googleLinkFailed' : 'security.unlinkFailed'
        this.googleError.set(authErrorMessage(apiError, fallback))
      }
    }
    this.busyWith.set(null)
  }

  protected async confirmWithCode(action: GoogleAction, code: string): Promise<void> {
    if (await this.reauth.verifyCode(code)) {
      await this.runGoogle(action)
    }
  }

  protected cancelGoogle(): void {
    this.reauth.close()
    this.confirming.set(null)
  }

  protected async revoke(id: string): Promise<void> {
    this.busyWith.set('revoke')
    this.devicesError.set(null)
    try {
      await this.authService.revokeSession(id)
      this.confirming.set(null)
      toast.success(this.transloco.translate('security.signedOutDevice'))
    } catch (error) {
      const apiError = toApiError(error)
      // Already gone (it signed out or expired meanwhile): the reload below shows that.
      if (apiError.status !== 404) {
        this.devicesError.set(authErrorMessage(apiError, 'security.signOutFailed'))
      }
      this.confirming.set(null)
    }
    await this.loadDevices()
    this.busyWith.set(null)
  }

  protected async revokeOthers(): Promise<void> {
    this.busyWith.set('revokeOthers')
    this.devicesError.set(null)
    try {
      const count = await this.authService.revokeOtherSessions()
      this.confirming.set(null)
      toast.success(this.transloco.translate('security.signedOutOthers', { count }))
    } catch (error) {
      this.devicesError.set(authErrorMessage(toApiError(error), 'security.signOutFailed'))
      this.confirming.set(null)
    }
    await this.loadDevices()
    this.busyWith.set(null)
  }

  /** Rule 1: this device stops being trusted, and its local data goes with it. */
  protected async turnOfflineOff(): Promise<void> {
    await this.offlineService.wipe()
    this.confirming.set(null)
    toast.success(this.transloco.translate('security.offlineOffDone'))
  }

  protected deviceIcon(label: DeviceLabel): string {
    return DEVICE_ICONS[label.kind]
  }

  protected async back(): Promise<void> {
    await this.router.navigate(['/account'])
  }

  private toRow(session: AuthDeviceSession): DeviceRow {
    const locale = this.languageService.locale()
    const signedInAt = new Date(session.signedInAt)
    const sameYear = signedInAt.getFullYear() === new Date().getFullYear()
    const signedIn = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: sameYear ? undefined : 'numeric',
    }).format(signedInAt)
    return {
      session,
      label: deviceLabel(session.userAgent),
      signedIn,
      lastActive: this.relativeTime(new Date(session.lastUsedAt), locale),
    }
  }

  /** "5 minutes ago" / "5 นาทีที่ผ่านมา"; `null` under a minute. */
  private relativeTime(at: Date, locale: string): string | null {
    const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    const elapsed = Date.now() - at.getTime()
    if (elapsed < MINUTE) {
      return null
    }
    if (elapsed < HOUR) {
      return format.format(-Math.floor(elapsed / MINUTE), 'minute')
    }
    if (elapsed < DAY) {
      return format.format(-Math.floor(elapsed / HOUR), 'hour')
    }
    return format.format(-Math.floor(elapsed / DAY), 'day')
  }
}
