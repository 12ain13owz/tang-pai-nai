import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
import type { ValidatorFn } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideArchive,
  lucideArchiveRestore,
  lucideChevronRight,
  lucideTrash2,
} from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { CATEGORY_DEFAULT_ICON, CategoryService } from '@/core/category'
import type { CategoryType } from '@/core/category'
import { LanguageService } from '@/core/i18n'
import { ProfileService } from '@/core/profile'
import { WALLET_LIMITS, WalletService } from '@/core/wallet'
import type { UnarchiveRefusal, WalletSheetState, WalletValues } from '@/core/wallet'
import {
  AmountField,
  ColorField,
  FORM_IMPORTS,
  IconField,
  NameIconField,
  SwitchField,
  ToggleListField,
  withMessage,
} from '@/shared/components/form'
import type { ToggleListItem } from '@/shared/components/form'
import {
  USER_COLORS,
  userColor,
  WALLET_DEFAULT_ICON,
  WALLET_ICON_GROUPS,
} from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import type { SelectOption } from '@/shared/types'
import { parseMajor, toMajorText } from '@/shared/utils'
import type { WalletFormGroup } from './wallet-form.type'

type View = 'form' | 'icons' | 'categories' | 'confirmDelete' | 'confirmDiscard'

const CATEGORY_TABS: readonly CategoryType[] = ['expense', 'income']

const REFUSAL_KEYS: Record<UnarchiveRefusal, string> = {
  nameTaken: 'wallets.unarchiveNameTaken',
  limit: 'wallets.unarchiveLimit',
}

/**
 * The wallet form (docs/features/wallet.md → Web screens), a compact sheet (DESIGN.md §6): icon +
 * name, starting balance + currency, "exclude from total"; the icon opens an icon-and-colour view.
 * Create, edit, "fix" a rejected op; in edit mode the header holds archive and delete (after a
 * confirm view). Opened from anywhere through `WalletService.open()`; the shell loads it on first
 * use.
 */
@Component({
  selector: 'app-wallet-sheet',
  imports: [
    FORM_IMPORTS,
    ReactiveFormsModule,
    TranslocoPipe,
    NgIcon,
    NameIconField,
    AmountField,
    SwitchField,
    ToggleListField,
    IconField,
    ColorField,
    HlmButton,
    HlmDrawerImports,
    SheetFrame,
  ],
  providers: [
    provideIcons({ lucideArchive, lucideArchiveRestore, lucideChevronRight, lucideTrash2 }),
  ],
  template: `
    @let f = form.controls;
    <hlm-drawer [state]="open() ? 'open' : 'closed'" (closed)="onClosed()">
      <hlm-drawer-content
        *hlmDrawerPortal
        class="mx-auto h-[92dvh] w-full max-w-[480px] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
      >
        @switch (view()) {
          @case ('form') {
            <form [formGroup]="form" class="flex min-h-0 flex-1 flex-col" (ngSubmit)="save()">
              <app-sheet-frame
                [title]="heading() | transloco"
                [leadingLabel]="'sheet.close' | transloco"
                (leading)="close()"
              >
                @if (editing(); as wallet) {
                  <div sheetActions class="flex">
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon"
                      type="button"
                      class="size-11"
                      [disabled]="!walletService.canWrite()"
                      [attr.aria-label]="
                        (wallet.isArchived ? 'wallets.unarchive' : 'wallets.archive') | transloco
                      "
                      (click)="toggleArchive()"
                    >
                      <ng-icon
                        [name]="wallet.isArchived ? 'lucideArchiveRestore' : 'lucideArchive'"
                        size="20"
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon"
                      type="button"
                      class="size-11 text-destructive"
                      [disabled]="!walletService.canWrite()"
                      [attr.aria-label]="'wallets.delete' | transloco"
                      (click)="view.set('confirmDelete')"
                    >
                      <ng-icon name="lucideTrash2" size="20" aria-hidden="true" />
                    </button>
                  </div>
                }
                <div class="flex flex-col gap-5">
                  @if (!walletService.canWrite()) {
                    <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {{ 'wallets.needsOnline' | transloco }}
                    </p>
                  }
                  @if (refusal()) {
                    <p role="alert" class="text-sm text-destructive">
                      {{ refusal() | transloco }}
                    </p>
                  }
                  <app-name-icon-field
                    [control]="f.name"
                    [label]="'wallets.name' | transloco"
                    [icon]="f.icon.value"
                    [color]="f.color.value"
                    [fallback]="defaultIcon"
                    [iconLabel]="'wallets.changeIcon' | transloco"
                    (iconClick)="view.set('icons')"
                  />
                  <div class="flex flex-col gap-1">
                    <app-amount-field
                      [control]="f.initialBalance"
                      [negative]="f.negative"
                      [label]="'wallets.initialBalance' | transloco"
                    >
                      @if (!currencyLocked() && currencyOptions().length > 1) {
                        <select
                          amountSuffix
                          class="h-9 max-w-28 shrink-0 rounded-full bg-muted px-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          [formControl]="f.currencyCode"
                          [attr.aria-label]="'wallets.currency' | transloco"
                        >
                          @for (option of currencyOptions(); track option.value) {
                            <option [value]="option.value">{{ option.label }}</option>
                          }
                        </select>
                      } @else {
                        <span amountSuffix class="shrink-0 text-sm text-muted-foreground">
                          {{ f.currencyCode.value }}
                        </span>
                      }
                    </app-amount-field>
                    @if (currencyLocked()) {
                      <p class="pl-14 text-sm text-muted-foreground">
                        {{ 'wallets.currencyLocked' | transloco }}
                      </p>
                    }
                  </div>
                  <div class="-mx-4 border-t border-border"></div>
                  <app-switch-field
                    [control]="f.excludeFromTotal"
                    [label]="'wallets.excludeFromTotal' | transloco"
                  />
                  <div class="-mx-4 -mt-1 flex flex-col border-y border-border">
                    <button
                      type="button"
                      class="flex min-h-12 items-center gap-3 px-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      (click)="view.set('categories')"
                    >
                      <span class="text-muted-foreground">{{
                        'wallets.categoriesUsed' | transloco
                      }}</span>
                      <span class="min-w-0 flex-1 truncate text-right">
                        @if (hiddenCount() === 0) {
                          {{ 'wallets.categoriesAll' | transloco }}
                        } @else {
                          {{ 'wallets.categoriesHidden' | transloco: { count: hiddenCount() } }}
                        }
                      </span>
                      <ng-icon
                        name="lucideChevronRight"
                        size="20"
                        class="text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>
                <div sheetFooter class="pt-3">
                  <button
                    hlmBtn
                    type="submit"
                    class="h-11 w-full text-base"
                    [disabled]="!walletService.canWrite()"
                  >
                    {{ 'wallets.save' | transloco }}
                  </button>
                </div>
              </app-sheet-frame>
            </form>
          }
          @case ('icons') {
            <app-sheet-frame
              [title]="'wallets.iconHeading' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <div class="flex flex-col gap-6">
                <app-color-field
                  [control]="f.color"
                  [label]="'wallets.color' | transloco"
                  [colors]="colors"
                />
                <app-icon-field
                  [control]="f.icon"
                  [label]="'wallets.icon' | transloco"
                  [groups]="iconGroups"
                  [color]="f.color.value"
                />
              </div>
            </app-sheet-frame>
          }
          @case ('categories') {
            <app-sheet-frame
              [title]="'wallets.categoriesUsed' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <div class="flex flex-col gap-4">
                <div
                  class="flex rounded-lg bg-muted p-1"
                  role="tablist"
                  [attr.aria-label]="'categories.tabsLabel' | transloco"
                >
                  @for (tab of categoryTabs; track tab) {
                    <button
                      type="button"
                      role="tab"
                      class="flex h-10 flex-1 items-center justify-center rounded-md text-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-selected:bg-card aria-selected:font-semibold aria-selected:text-foreground aria-selected:shadow-sm"
                      [attr.aria-selected]="categoryTab() === tab"
                      (click)="categoryTab.set(tab)"
                    >
                      {{ 'categories.' + tab | transloco }}
                    </button>
                  }
                </div>
                @if (categoryItems().length > 0) {
                  <app-toggle-list-field
                    [control]="f.hiddenCategoryIds"
                    [label]="'wallets.categoriesUsed' | transloco"
                    [items]="categoryItems()"
                  />
                } @else {
                  <p class="text-sm text-muted-foreground">
                    {{
                      'categories.emptyHeading'
                        | transloco: { label: 'categories.' + categoryTab() | transloco }
                    }}
                  </p>
                }
              </div>
            </app-sheet-frame>
          }
          @case ('confirmDelete') {
            <app-sheet-frame
              [title]="'wallets.delete' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <div class="flex flex-col gap-2">
                <p class="text-base font-semibold">
                  {{ 'wallets.deleteHeading' | transloco: { name: editingName() } }}
                </p>
                <p class="text-sm text-muted-foreground">{{ 'wallets.deleteText' | transloco }}</p>
              </div>
              <div sheetFooter class="pt-3">
                <button
                  hlmBtn
                  variant="destructive"
                  type="button"
                  class="h-11 w-full text-base"
                  (click)="remove()"
                >
                  {{ 'wallets.deleteConfirm' | transloco }}
                </button>
              </div>
            </app-sheet-frame>
          }
          @case ('confirmDiscard') {
            <app-sheet-frame
              [title]="'wallets.discardHeading' | transloco"
              leadingIcon="back"
              [leadingLabel]="'wallets.keepEditing' | transloco"
              (leading)="view.set('form')"
            >
              <p class="text-sm text-muted-foreground">{{ 'wallets.discardText' | transloco }}</p>
              <div sheetFooter class="pt-3">
                <button
                  hlmBtn
                  variant="destructive"
                  type="button"
                  class="h-11 w-full text-base"
                  (click)="finish()"
                >
                  {{ 'wallets.discard' | transloco }}
                </button>
              </div>
            </app-sheet-frame>
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
  private categoryService = inject(CategoryService)
  private profileService = inject(ProfileService)

  protected iconGroups = WALLET_ICON_GROUPS
  protected defaultIcon = WALLET_DEFAULT_ICON
  protected colors = USER_COLORS
  protected state = this.walletService.sheet
  protected view = signal<View>('form')
  protected categoryTabs = CATEGORY_TABS
  protected categoryTab = signal<CategoryType>('expense')
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
  /** The profile whose categories the wallet picks from (category rule 13). */
  private categoryProfileId = computed(
    () => this.profileId() ?? this.profileService.current()?.id ?? null
  )
  /** The ids switched off in the categories view (signal copy of the control). */
  private hidden = signal<readonly string[]>([])
  /** "ซ่อน n": the profile's open categories hidden here, children of a hidden parent too. */
  protected hiddenCount = computed(() => {
    const profileId = this.categoryProfileId()
    const hidden = this.hidden()
    if (!profileId || hidden.length === 0) {
      return 0
    }
    return CATEGORY_TABS.flatMap((type) => this.categoryService.treeOf(profileId, type)).flatMap(
      (node) =>
        hidden.includes(node.category.id)
          ? [node.category, ...node.children]
          : node.children.filter((child) => hidden.includes(child.id))
    ).length
  })
  protected categoryItems = computed<ToggleListItem[]>(() => {
    const profileId = this.categoryProfileId()
    if (!profileId) {
      return []
    }
    const hidden = this.hidden()
    const note = this.transloco.translate('categories.hiddenWithParent')
    this.languageService.language()
    return this.categoryService
      .treeOf(profileId, this.categoryTab())
      .flatMap((node) => [
        this.categoryItem(node.category, false, null),
        ...node.children.map((child) =>
          this.categoryItem(child, true, hidden.includes(node.category.id) ? note : null)
        ),
      ])
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
    hiddenCategoryIds: this.nnfb.control<string[]>([]),
  })

  /** Unsaved input: swiping or tapping the sheet away asks first (DESIGN.md §6). */
  protected dirty = signal(false)
  protected open = signal(false)

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.dirty.set(this.form.dirty)
      this.refusal.set(null)
      this.hidden.set(this.form.controls.hiddenCategoryIds.value)
    })
    // Picking an icon is the icon view's answer: back to the form.
    this.form.controls.icon.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.view() === 'icons') {
        this.view.set('form')
      }
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
      hiddenCategoryIds: value.hiddenCategoryIds,
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

  /**
   * Rule 6: archive (or bring back) at once, with "undo" in the toast; coming back may be refused
   * (rule 3). Unsaved edits keep the sheet open.
   */
  protected toggleArchive(): void {
    const wallet = this.editing()
    if (!wallet) {
      return
    }
    const archived = !wallet.isArchived
    const refusal = this.walletService.setArchived(wallet.id, archived)
    if (refusal) {
      this.refusal.set(REFUSAL_KEYS[refusal])
      return
    }
    toast(
      this.transloco.translate(archived ? 'wallets.archived' : 'wallets.unarchived', {
        name: wallet.name,
      }),
      {
        action: {
          label: this.transloco.translate('wallets.undo'),
          onClick: () => {
            const undone = this.walletService.setArchived(wallet.id, !archived)
            if (undone) {
              toast.error(this.transloco.translate(REFUSAL_KEYS[undone]))
            }
          },
        },
      }
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

  private categoryItem(
    category: { id: string; name: string; icon: string; color: string },
    child: boolean,
    lockedNote: string | null
  ): ToggleListItem {
    return {
      id: category.id,
      label: category.name,
      icon: category.icon,
      color: userColor(category.color),
      fallback: CATEGORY_DEFAULT_ICON,
      child,
      lockedNote,
    }
  }

  private minorUnit(): number {
    return this.walletService.minorUnit(this.form.controls.currencyCode.value)
  }

  private start(state: WalletSheetState): void {
    this.view.set('form')
    this.categoryTab.set('expense')
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
        hiddenCategoryIds: [],
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
      color: userColor(values.color),
      hiddenCategoryIds: values.hiddenCategoryIds,
    }
  }
}
