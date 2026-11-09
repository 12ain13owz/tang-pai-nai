import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import type { FormControl, FormGroup } from '@angular/forms'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { LanguageService } from '@/core/i18n'
import { ProfileService } from '@/core/profile'
import { SharingService } from '@/core/sharing'
import type { ShareGroup, ShareRole, SharingInvite, SharingMember } from '@/core/sharing'
import { WalletService } from '@/core/wallet'
import {
  FORM_IMPORTS,
  InputField,
  SegmentedField,
  ToggleListField,
  withMessage,
} from '@/shared/components/form'
import type { ToggleListItem } from '@/shared/components/form'
import { WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'

/** What the sheet shows (docs/features/sharing.md → Web screens, mock-up frames 3–4, 6). */
export type ShareSheetState =
  | { view: 'invite' }
  | { view: 'member'; member: SharingMember }
  | { view: 'pending'; invite: SharingInvite }
  | { view: 'leave'; group: ShareGroup }

type ShareFormGroup = FormGroup<{
  email: FormControl<string>
  role: FormControl<ShareRole>
  /** The wallets switched **off** (`app-toggle-list-field` keeps those). */
  offWalletIds: FormControl<string[]>
}>

/**
 * The sharing page's one sheet: invite a person, change a member (role, wallets, remove), a
 * pending invite (send again, cancel) and leaving someone's sharing. Every action is an online
 * call (sharing rule 10); the page reloads what it shows from the service afterwards.
 */
@Component({
  selector: 'app-share-sheet',
  imports: [
    TranslocoPipe,
    HlmButton,
    HlmDrawerImports,
    HlmSpinner,
    SheetFrame,
    FORM_IMPORTS,
    InputField,
    SegmentedField,
    ToggleListField,
  ],
  template: `
    <hlm-drawer [state]="state() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-drawer-content
        *hlmDrawerPortal
        class="mx-auto h-[92dvh] w-full max-w-[480px] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
      >
        @if (state(); as current) {
          <app-sheet-frame
            [title]="title()"
            [leadingIcon]="confirming() ? 'back' : 'close'"
            [leadingLabel]="(confirming() ? 'sheet.back' : 'sheet.close') | transloco"
            (leading)="confirming() ? confirming.set(false) : closed.emit()"
          >
            <div class="flex flex-col gap-4">
              @if (!sharingService.canCall()) {
                <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {{ 'sharing.needsOnline' | transloco }}
                </p>
              }
              @switch (current.view) {
                @case ('leave') {
                  <p class="text-base font-semibold">
                    {{
                      'sharing.leaveHeading' | transloco: { name: current.group.owner.displayName }
                    }}
                  </p>
                  <p class="text-sm text-muted-foreground">
                    {{ 'sharing.leaveText' | transloco: { name: current.group.owner.displayName } }}
                  </p>
                }
                @case ('pending') {
                  <div class="rounded-xl border border-border bg-card px-4 py-3">
                    <p class="text-base break-all">{{ current.invite.email }}</p>
                    <p class="text-sm text-muted-foreground">
                      {{ 'sharing.' + current.invite.role | transloco }} ·
                      {{ walletNames(current.invite.walletIds) }}
                    </p>
                    <p class="text-sm text-muted-foreground">
                      {{ 'sharing.sentOn' | transloco: { date: date(current.invite.lastSentAt) } }}
                      ·
                      {{ 'sharing.expires' | transloco: { date: date(current.invite.expiresAt) } }}
                    </p>
                  </div>
                }
                @default {
                  @if (confirming() && current.view === 'member') {
                    <p class="text-base font-semibold">
                      {{
                        'sharing.removeHeading' | transloco: { name: current.member.displayName }
                      }}
                    </p>
                    <p class="text-sm text-muted-foreground">
                      {{ 'sharing.removeText' | transloco: { name: current.member.displayName } }}
                    </p>
                  } @else {
                    <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="submit()">
                      @if (current.view === 'member') {
                        <div class="rounded-xl border border-border bg-card px-4 py-3">
                          <p class="text-base">{{ current.member.displayName }}</p>
                          <p class="text-sm break-all text-muted-foreground">
                            {{ current.member.email }} ·
                            {{
                              'sharing.joined' | transloco: { date: date(current.member.addedAt) }
                            }}
                          </p>
                        </div>
                      } @else {
                        <app-input-field
                          [control]="form.controls.email"
                          [label]="'sharing.email' | transloco"
                          type="email"
                          inputmode="email"
                          autocomplete="off"
                          placeholder="name@example.com"
                        />
                      }
                      <div class="flex flex-col gap-2">
                        <span class="text-sm font-medium text-muted-foreground">{{
                          'sharing.roleAll' | transloco
                        }}</span>
                        <app-segmented-field
                          [control]="$any(form.controls.role)"
                          [label]="'sharing.role' | transloco"
                          [options]="roleOptions()"
                        />
                        <p class="text-sm text-muted-foreground">
                          {{ 'sharing.' + role() + 'Hint' | transloco }}
                        </p>
                      </div>
                      <div class="flex flex-col gap-2">
                        <div class="flex items-center justify-between px-1">
                          <span class="text-sm font-medium text-muted-foreground">{{
                            'sharing.walletsPicked'
                              | transloco: { count: pickedCount(), total: walletItems().length }
                          }}</span>
                          <button
                            type="button"
                            class="min-h-10 px-1 text-sm font-semibold text-brand"
                            (click)="toggleAll()"
                          >
                            {{
                              (pickedCount() === walletItems().length
                                ? 'sharing.selectNone'
                                : 'sharing.selectAll'
                              ) | transloco
                            }}
                          </button>
                        </div>
                        @if (walletItems().length === 0) {
                          <p class="text-sm text-muted-foreground">
                            {{ 'sharing.noWallets' | transloco }}
                          </p>
                        } @else {
                          <app-toggle-list-field
                            [control]="form.controls.offWalletIds"
                            [label]="'sharing.walletsPicked' | transloco"
                            [items]="walletItems()"
                          />
                        }
                        @if (current.view === 'invite' && pickedCount() === 0) {
                          <p class="px-1 text-sm text-destructive">
                            {{ 'sharing.pickOne' | transloco }}
                          </p>
                        }
                      </div>
                      @if (current.view === 'invite') {
                        <p class="text-sm text-muted-foreground">
                          {{ 'sharing.inviteNote' | transloco }}
                        </p>
                      } @else {
                        <button
                          hlmBtn
                          variant="ghost"
                          type="button"
                          class="h-11 text-destructive"
                          [disabled]="busy() || !sharingService.canCall()"
                          (click)="confirming.set(true)"
                        >
                          {{ 'sharing.remove' | transloco }}
                        </button>
                      }
                    </form>
                  }
                }
              }
              @if (error(); as key) {
                <p
                  class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  role="alert"
                >
                  {{ key | transloco }}
                </p>
              }
            </div>
            <div sheetFooter class="flex flex-col gap-2 pt-3">
              @switch (current.view) {
                @case ('pending') {
                  <button
                    hlmBtn
                    type="button"
                    class="h-11 w-full text-base"
                    [disabled]="busy() || !sharingService.canCall()"
                    (click)="run('resend')"
                  >
                    {{ 'sharing.resend' | transloco }}
                  </button>
                  <button
                    hlmBtn
                    variant="ghost"
                    type="button"
                    class="h-11 w-full text-base text-destructive"
                    [disabled]="busy() || !sharingService.canCall()"
                    (click)="run('cancel')"
                  >
                    {{ 'sharing.cancelInvite' | transloco }}
                  </button>
                }
                @case ('leave') {
                  <button
                    hlmBtn
                    variant="destructive"
                    type="button"
                    class="h-11 w-full text-base"
                    [disabled]="busy() || !sharingService.canCall()"
                    (click)="run('leave')"
                  >
                    {{ 'sharing.leaveConfirm' | transloco }}
                  </button>
                }
                @default {
                  @if (confirming()) {
                    <button
                      hlmBtn
                      variant="destructive"
                      type="button"
                      class="h-11 w-full text-base"
                      [disabled]="busy() || !sharingService.canCall()"
                      (click)="run('remove')"
                    >
                      {{ 'sharing.remove' | transloco }}
                    </button>
                  } @else {
                    <button
                      hlmBtn
                      type="button"
                      class="h-11 w-full text-base"
                      [disabled]="busy() || !sharingService.canCall() || !canSubmit()"
                      (click)="submit()"
                    >
                      @if (busy()) {
                        <hlm-spinner class="size-5" />
                      }
                      {{
                        (current.view === 'invite' ? 'sharing.send' : 'sharing.save') | transloco
                      }}
                    </button>
                  }
                }
              }
            </div>
          </app-sheet-frame>
        }
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class ShareSheet {
  protected sharingService = inject(SharingService)
  private walletService = inject(WalletService)
  private profileService = inject(ProfileService)
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)
  private nnfb = inject(NonNullableFormBuilder)

  state = input<ShareSheetState | null>(null)
  closed = output()

  protected busy = signal(false)
  protected error = signal<string | null>(null)
  protected confirming = signal(false)

  protected form: ShareFormGroup = this.nnfb.group({
    email: [
      '',
      [
        withMessage(Validators.required, 'sharing.emailRequired'),
        withMessage(Validators.email, 'sharing.emailInvalid'),
      ],
    ],
    role: this.nnfb.control<ShareRole>('editor'),
    offWalletIds: this.nnfb.control<string[]>([]),
  })
  private formValue = signal(this.form.getRawValue())
  private emailValid = signal(false)
  protected role = computed(() => this.formValue().role)

  /** Rule 2: the profile's open wallets (archived ones aren't offered). */
  private openWallets = computed(() => this.walletService.wallets().filter((w) => !w.isArchived))
  protected walletItems = computed<ToggleListItem[]>(() =>
    this.openWallets().map((wallet) => ({
      id: wallet.id,
      label: wallet.name,
      icon: wallet.icon,
      color: wallet.color,
      fallback: WALLET_DEFAULT_ICON,
    }))
  )
  protected pickedCount = computed(
    () => this.walletItems().length - this.formValue().offWalletIds.length
  )
  protected canSubmit = computed(() => {
    const view = this.state()?.view
    return view === 'member' || (this.pickedCount() > 0 && this.emailValid())
  })
  protected roleOptions = computed(() => {
    this.languageService.language()
    return (['editor', 'viewer'] as const).map((value) => ({
      value,
      label: this.transloco.translate(`sharing.${value}`),
    }))
  })
  protected title = computed(() => {
    this.languageService.language()
    const state = this.state()
    switch (state?.view) {
      case 'member':
        return state.member.displayName
      case 'pending':
        return this.transloco.translate('sharing.pendingTitle')
      case 'leave':
        return this.transloco.translate('sharing.leave', { name: state.group.owner.displayName })
      default:
        return this.transloco.translate('sharing.invite')
    }
  })

  constructor() {
    // Every form event (value or validity) refreshes the signals the template reads.
    this.form.events.pipe(takeUntilDestroyed()).subscribe(() => {
      this.formValue.set(this.form.getRawValue())
      this.emailValid.set(this.form.controls.email.valid)
    })
    // A new state starts a fresh form: an invite ticks every wallet, a member their wallets.
    effect(() => {
      const state = this.state()
      untracked(() => this.reset(state))
    })
  }

  protected date(at: number): string {
    return new Intl.DateTimeFormat(this.languageService.locale(), { dateStyle: 'medium' }).format(
      at
    )
  }

  protected walletNames(ids: string[]): string {
    return ids
      .map((id) => this.walletService.byId(id)?.name)
      .filter((name) => name)
      .join(', ')
  }

  protected toggleAll(): void {
    const all = this.walletItems().map((item) => item.id)
    const off = this.pickedCount() === all.length ? all : []
    this.form.controls.offWalletIds.setValue(off)
  }

  protected async submit(): Promise<void> {
    const state = this.state()
    const profileId = this.profileService.current()?.id
    this.form.markAllAsTouched()
    if (!state || !profileId || !this.canSubmit() || this.busy()) {
      return
    }
    const { email, role, offWalletIds } = this.form.getRawValue()
    const off = new Set(offWalletIds)
    const walletIds = this.openWallets()
      .map((w) => w.id)
      .filter((id) => !off.has(id))
    await this.guard(async () => {
      if (state.view === 'member') {
        await this.sharingService.updateMember(profileId, state.member.userId, { role, walletIds })
        toast.success(this.t(walletIds.length ? 'sharing.saved' : 'sharing.removed'))
      } else {
        await this.sharingService.invite(
          profileId,
          { email: email.trim(), role, walletIds },
          this.lang()
        )
        toast.success(this.t('sharing.sent'))
      }
    })
  }

  protected async run(action: 'resend' | 'cancel' | 'leave' | 'remove'): Promise<void> {
    const state = this.state()
    const profileId = this.profileService.current()?.id ?? ''
    if (!state || this.busy()) {
      return
    }
    await this.guard(async () => {
      if (state.view === 'pending' && action === 'resend') {
        await this.sharingService.resend(profileId, state.invite.id, this.lang())
        toast.success(this.t('sharing.resent'))
      } else if (state.view === 'pending') {
        await this.sharingService.cancel(profileId, state.invite.id)
        toast.success(this.t('sharing.cancelled'))
      } else if (state.view === 'leave') {
        await this.sharingService.leave(state.group.profileId)
        toast.success(this.t('sharing.left'))
      } else if (state.view === 'member') {
        await this.sharingService.removeMember(profileId, state.member.userId)
        toast.success(this.t('sharing.removed'))
      }
    })
  }

  /** Runs one call: closes the sheet on success, shows the failure's text otherwise. */
  private async guard(work: () => Promise<void>): Promise<void> {
    this.busy.set(true)
    this.error.set(null)
    try {
      await work()
      this.closed.emit()
    } catch (error) {
      this.error.set(this.sharingService.failure(error))
    } finally {
      this.busy.set(false)
    }
  }

  private reset(state: ShareSheetState | null): void {
    this.error.set(null)
    this.confirming.set(false)
    const all = this.openWallets().map((w) => w.id)
    const shared = state?.view === 'member' ? new Set(state.member.walletIds) : new Set(all)
    this.form.reset({
      email: '',
      role: state?.view === 'member' ? state.member.role : 'editor',
      offWalletIds: all.filter((id) => !shared.has(id)),
    })
  }

  private lang(): string {
    return this.languageService.language().id
  }

  private t(key: string): string {
    return this.transloco.translate(key)
  }
}
