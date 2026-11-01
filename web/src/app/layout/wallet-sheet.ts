import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import type { ValidatorFn } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { LanguageService } from '@/core/i18n'
import { WALLET_LIMITS, WalletService } from '@/core/wallet'
import type { UnarchiveRefusal, WalletSheetState, WalletValues } from '@/core/wallet'
import {
  AmountField,
  ColorField,
  FORM_IMPORTS,
  IconField,
  InputField,
  SelectField,
  SwitchField,
  withMessage,
} from '@/shared/components/form'
import {
  USER_COLORS,
  WALLET_DEFAULT_ICON,
  WALLET_ICON_GROUPS,
} from '@/shared/components/icon-badge'
import type { SelectOption } from '@/shared/types'
import { parseMajor, toMajorText } from '@/shared/utils'
import type { WalletFormGroup } from './wallet-form.type'

type View = 'form' | 'confirmDelete' | 'confirmDiscard'

const REFUSAL_KEYS: Record<UnarchiveRefusal, string> = {
  nameTaken: 'wallets.unarchiveNameTaken',
  limit: 'wallets.unarchiveLimit',
}

/**
 * The wallet form (docs/features/wallet.md → Web screens): create, edit, "fix" a rejected op,
 * archive, and delete after a confirm step. Opened from anywhere through `WalletService.open()`;
 * the shell loads it on first use.
 */
@Component({
  selector: 'app-wallet-sheet',
  imports: [
    FORM_IMPORTS,
    TranslocoPipe,
    InputField,
    AmountField,
    SelectField,
    SwitchField,
    IconField,
    ColorField,
    HlmButton,
    HlmDrawerImports,
  ],
  template: `
    @let f = form.controls;
    <hlm-drawer [state]="open() ? 'open' : 'closed'" (closed)="onClosed()">
      <hlm-drawer-content *hlmDrawerPortal class="mx-auto max-w-[480px]">
        @switch (view()) {
          @case ('form') {
            <form
              [formGroup]="form"
              class="flex min-h-0 flex-1 flex-col gap-4 px-2 pt-2 pb-4"
              (ngSubmit)="save()"
            >
              <h2 hlmDrawerTitle class="text-lg font-semibold">
                {{ heading() | transloco }}
              </h2>
              <div class="-mx-2 flex min-h-0 flex-col gap-6 overflow-y-auto px-2 pb-1">
                @if (!walletService.canWrite()) {
                  <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {{ 'wallets.needsOnline' | transloco }}
                  </p>
                }
                <app-input-field
                  [control]="f.name"
                  [label]="'wallets.name' | transloco"
                  [placeholder]="'wallets.namePlaceholder' | transloco"
                  autocomplete="off"
                />
                <app-amount-field
                  [control]="f.initialBalance"
                  [negative]="f.negative"
                  [label]="'wallets.initialBalance' | transloco"
                  [hint]="'wallets.initialBalanceHint' | transloco"
                  [suffix]="f.currencyCode.value"
                />
                @if (currencyLocked()) {
                  <div class="flex flex-col gap-1">
                    <p class="text-sm font-medium">{{ 'wallets.currency' | transloco }}</p>
                    <p class="text-base">{{ currencyLabel(f.currencyCode.value) }}</p>
                    <p class="text-sm text-muted-foreground">
                      {{ 'wallets.currencyLocked' | transloco }}
                    </p>
                  </div>
                } @else if (currencyOptions().length > 1) {
                  <app-select-field
                    [control]="f.currencyCode"
                    [label]="'wallets.currency' | transloco"
                    [options]="currencyOptions()"
                  />
                }
                <app-switch-field
                  [control]="f.excludeFromTotal"
                  [label]="'wallets.excludeFromTotal' | transloco"
                  [hint]="'wallets.excludeFromTotalHint' | transloco"
                />
                <app-icon-field
                  [control]="f.icon"
                  [label]="'wallets.icon' | transloco"
                  [groups]="iconGroups"
                  [color]="f.color.value"
                />
                <app-color-field
                  [control]="f.color"
                  [label]="'wallets.color' | transloco"
                  [colors]="colors"
                />
                @if (editing(); as wallet) {
                  <div class="flex flex-col gap-3 border-t border-border pt-6">
                    <button
                      hlmBtn
                      variant="outline"
                      type="button"
                      class="h-11 w-full"
                      [disabled]="!walletService.canWrite()"
                      (click)="toggleArchive()"
                    >
                      {{
                        (wallet.isArchived ? 'wallets.unarchive' : 'wallets.archive') | transloco
                      }}
                    </button>
                    @if (refusal()) {
                      <p role="alert" class="-mt-1 text-sm text-destructive">
                        {{ refusal() | transloco }}
                      </p>
                    } @else {
                      <p class="-mt-1 text-sm text-muted-foreground">
                        {{ 'wallets.archiveHint' | transloco }}
                      </p>
                    }
                    <button
                      hlmBtn
                      variant="outline"
                      type="button"
                      class="h-11 w-full text-destructive"
                      [disabled]="!walletService.canWrite()"
                      (click)="view.set('confirmDelete')"
                    >
                      {{ 'wallets.delete' | transloco }}
                    </button>
                  </div>
                }
              </div>
              <div class="flex flex-col gap-3">
                <button
                  hlmBtn
                  type="submit"
                  class="h-11 w-full text-base"
                  [disabled]="!walletService.canWrite()"
                >
                  {{ 'wallets.save' | transloco }}
                </button>
                <button
                  hlmBtn
                  variant="outline"
                  type="button"
                  class="h-11 w-full"
                  (click)="close()"
                >
                  {{ 'wallets.close' | transloco }}
                </button>
              </div>
            </form>
          }
          @case ('confirmDelete') {
            <div class="flex flex-col gap-6 px-2 pt-2 pb-4">
              <div class="flex flex-col gap-2">
                <h2 hlmDrawerTitle class="text-lg font-semibold">
                  {{ 'wallets.deleteHeading' | transloco: { name: editingName() } }}
                </h2>
                <p class="text-sm text-muted-foreground">
                  {{ 'wallets.deleteText' | transloco }}
                </p>
              </div>
              <div class="flex flex-col gap-3">
                <button
                  hlmBtn
                  variant="destructive"
                  type="button"
                  class="h-11 w-full text-base"
                  (click)="remove()"
                >
                  {{ 'wallets.deleteConfirm' | transloco }}
                </button>
                <button
                  hlmBtn
                  variant="outline"
                  type="button"
                  class="h-11 w-full"
                  (click)="view.set('form')"
                >
                  {{ 'wallets.cancel' | transloco }}
                </button>
              </div>
            </div>
          }
          @case ('confirmDiscard') {
            <div class="flex flex-col gap-6 px-2 pt-2 pb-4">
              <h2 hlmDrawerTitle class="text-lg font-semibold">
                {{ 'wallets.discardHeading' | transloco }}
              </h2>
              <div class="flex flex-col gap-3">
                <button
                  hlmBtn
                  variant="destructive"
                  type="button"
                  class="h-11 w-full text-base"
                  (click)="finish()"
                >
                  {{ 'wallets.discard' | transloco }}
                </button>
                <button
                  hlmBtn
                  variant="outline"
                  type="button"
                  class="h-11 w-full"
                  (click)="view.set('form')"
                >
                  {{ 'wallets.keepEditing' | transloco }}
                </button>
              </div>
            </div>
          }
        }
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class WalletSheet {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  private languageService = inject(LanguageService)
  protected walletService = inject(WalletService)

  protected iconGroups = WALLET_ICON_GROUPS
  protected colors = USER_COLORS
  protected state = this.walletService.sheet
  protected view = signal<View>('form')
  /** Why the wallet can't come back from the archive (a translation key). */
  protected refusal = signal<string | null>(null)

  /** The wallet being edited (edit and fix), null when creating. */
  protected editingId = computed(() => {
    const state = this.state()
    return state && state.mode !== 'create' ? state.id : null
  })
  /** The live wallet behind an edit (a refused create has none). */
  protected editing = computed(() => {
    const id = this.editingId()
    return id ? this.walletService.byId(id) : null
  })
  protected editingName = computed(() => this.editing()?.name ?? '')
  /** The profile the name must be unique in (wallet rule 3). */
  private profileId = computed(() => {
    const state = this.state()
    if (state?.mode === 'fix') {
      return this.editing()?.profileId ?? state.profileId
    }
    return this.editing()?.profileId ?? null
  })
  protected heading = computed(() => {
    switch (this.state()?.mode) {
      case 'edit':
        return 'wallets.editHeading'
      case 'fix':
        return 'wallets.fixHeading'
      default:
        return 'wallets.createHeading'
    }
  })
  /** Rule 4: shown read-only once the wallet has transactions (#8). */
  protected currencyLocked = computed(
    () => !this.walletService.canChangeCurrency(this.editing()?.id ?? null)
  )
  /** Active currencies, plus the wallet's own if it was switched off since (currency rule 3). */
  protected currencyOptions = computed<SelectOption[]>(() => {
    this.languageService.locale()
    const own = this.editing()?.currencyCode
    return this.walletService
      .currencies()
      .filter((currency) => currency.isActive || currency.code === own)
      .map((currency) => ({ value: currency.code, label: this.currencyLabel(currency.code) }))
  })

  // An archived wallet holds no name (rule 3); coming back is checked by `setArchived`.
  private nameFree: ValidatorFn = (control) =>
    typeof control.value === 'string' &&
    this.editing()?.isArchived !== true &&
    this.walletService.nameTaken(control.value, this.editingId(), this.profileId() ?? undefined)
      ? { nameTaken: 'wallets.nameTaken' }
      : null

  /** Rule 5: major-unit text in the currency's digits, within ±10¹⁵ minor units. */
  private balanceValid: ValidatorFn = (control) => {
    if (typeof control.value !== 'string') {
      return null
    }
    // The form isn't built yet on the first run; the currency then is still empty.
    const currency: unknown = control.parent?.get('currencyCode')?.value
    const parsed = parseMajor(
      control.value,
      this.walletService.minorUnit(typeof currency === 'string' ? currency : '')
    )
    if (!parsed.ok) {
      return parsed.error === 'decimals'
        ? { balanceDecimals: 'wallets.balanceDecimals' }
        : { balanceFormat: 'wallets.balanceFormat' }
    }
    return parsed.minor > WALLET_LIMITS.BALANCE_MAX
      ? { balanceTooBig: 'wallets.balanceTooBig' }
      : null
  }

  form: WalletFormGroup = this.nnfb.group({
    name: [
      '',
      [
        withMessage(Validators.required, 'wallets.nameRequired'),
        withMessage(Validators.pattern(/\S/), 'wallets.nameRequired'),
        Validators.maxLength(WALLET_LIMITS.NAME_MAX),
        this.nameFree,
      ],
    ],
    initialBalance: ['', [this.balanceValid]],
    negative: [false],
    currencyCode: [''],
    excludeFromTotal: [false],
    icon: [WALLET_DEFAULT_ICON as string],
    color: [USER_COLORS[0] as string],
  })

  /** Unsaved input: swiping or tapping the sheet away asks first (DESIGN.md §6). */
  protected dirty = signal(false)
  protected open = signal(false)

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.dirty.set(this.form.dirty)
      this.refusal.set(null)
    })
    // The balance's allowed decimals follow the currency.
    this.form.controls.currencyCode.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.form.controls.initialBalance.updateValueAndValidity())
    effect(() => {
      const state = this.state()
      untracked(() => {
        if (state) {
          this.start(state)
        }
        this.open.set(state !== null)
      })
    })
  }

  protected currencyLabel(code: string): string {
    const names = new Intl.DisplayNames(this.languageService.locale(), { type: 'currency' })
    return `${names.of(code) ?? code} (${code})`
  }

  protected save(): void {
    const state = this.state()
    if (!state || this.form.invalid || !this.walletService.canWrite()) {
      return
    }
    const value = this.form.getRawValue()
    const parsed = parseMajor(value.initialBalance, this.minorUnit())
    const magnitude = parsed.ok ? parsed.minor : 0
    const values: WalletValues = {
      name: value.name,
      icon: value.icon,
      color: value.color,
      currencyCode: value.currencyCode,
      initialBalance: value.negative && magnitude !== 0 ? -magnitude : magnitude,
      excludeFromTotal: value.excludeFromTotal,
    }
    if (state.mode === 'fix') {
      this.walletService.save(state.id, values, state.opId, state.profileId)
    } else {
      this.walletService.save(this.editingId(), values)
    }
    toast.success(
      this.transloco.translate(state.mode === 'create' ? 'wallets.created' : 'wallets.saved')
    )
    this.finish()
  }

  /** Rule 6: archive at once; coming back may be refused (rule 3). Unsaved edits stay. */
  protected toggleArchive(): void {
    const wallet = this.editing()
    if (!wallet) {
      return
    }
    const refusal = this.walletService.setArchived(wallet.id, !wallet.isArchived)
    if (refusal) {
      this.refusal.set(REFUSAL_KEYS[refusal])
      return
    }
    toast(
      this.transloco.translate(wallet.isArchived ? 'wallets.unarchived' : 'wallets.archived', {
        name: wallet.name,
      })
    )
    if (!this.form.dirty) {
      this.finish()
    }
  }

  protected remove(): void {
    const id = this.editingId()
    if (id) {
      const name = this.editingName()
      this.walletService.remove(id)
      toast(this.transloco.translate('wallets.deleted', { name }))
    }
    this.finish()
  }

  /** "ปิด": asks first when the form holds unsaved input (DESIGN.md §6). */
  protected close(): void {
    if (this.form.dirty) {
      this.view.set('confirmDiscard')
      return
    }
    this.finish()
  }

  /** Swiped down, tapped the backdrop or pressed Escape. */
  protected onClosed(): void {
    if (this.dirty() && this.state()) {
      // The drawer can't refuse to close, so it comes back with the question instead.
      this.view.set('confirmDiscard')
      this.open.set(false)
      setTimeout(() => this.open.set(true))
      return
    }
    this.state.set(null)
  }

  protected finish(): void {
    this.form.markAsPristine()
    this.dirty.set(false)
    this.state.set(null)
  }

  private minorUnit(): number {
    return this.walletService.minorUnit(this.form.controls.currencyCode.value)
  }

  private start(state: WalletSheetState): void {
    this.view.set('form')
    this.dirty.set(false)
    this.refusal.set(null)
    if (state.mode === 'create') {
      this.form.reset({
        name: '',
        initialBalance: '',
        negative: false,
        currencyCode: this.walletService.defaultCurrency(),
        excludeFromTotal: false,
        icon: WALLET_DEFAULT_ICON,
        color: USER_COLORS[0],
      })
      return
    }
    if (state.mode === 'fix') {
      this.form.reset(this.toForm(state.values))
      this.form.markAllAsTouched()
      this.form.markAsDirty()
      this.dirty.set(true)
      return
    }
    const wallet = this.walletService.byId(state.id)
    if (!wallet) {
      this.state.set(null)
      return
    }
    this.form.reset(this.toForm(wallet))
  }

  private toForm(values: WalletValues) {
    const minorUnit = this.walletService.minorUnit(values.currencyCode)
    return {
      name: values.name,
      initialBalance:
        values.initialBalance === 0 ? '' : toMajorText(values.initialBalance, minorUnit),
      negative: values.initialBalance < 0,
      currencyCode: values.currencyCode,
      excludeFromTotal: values.excludeFromTotal,
      icon: values.icon,
      color: values.color,
    }
  }
}
