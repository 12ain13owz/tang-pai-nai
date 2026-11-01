import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
import type { ValidatorFn } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideArchive,
  lucideArchiveRestore,
  lucideCheck,
  lucideChevronRight,
  lucideTrash2,
} from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { CATEGORY_DEFAULT_ICON, CATEGORY_LIMITS, CategoryService } from '@/core/category'
import type {
  CategorySheetState,
  CategoryType,
  CategoryUnarchiveRefusal,
  CategoryValues,
} from '@/core/category'
import { LanguageService } from '@/core/i18n'
import { ProfileService } from '@/core/profile'
import { WalletService } from '@/core/wallet'
import {
  ColorField,
  FORM_IMPORTS,
  IconField,
  NameIconField,
  SegmentedField,
  ToggleListField,
  withMessage,
} from '@/shared/components/form'
import type { ToggleListItem } from '@/shared/components/form'
import {
  CATEGORY_ICON_GROUPS,
  IconBadge,
  USER_COLORS,
  userColor,
  WALLET_DEFAULT_ICON,
} from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import type { SelectOption } from '@/shared/types'
import type { CategoryFormGroup } from './category-form.type'

type View = 'form' | 'icons' | 'parent' | 'wallets' | 'confirmDelete' | 'confirmDiscard'

const REFUSAL_KEYS: Record<CategoryUnarchiveRefusal, string> = {
  nameTaken: 'categories.unarchiveNameTaken',
  limit: 'categories.unarchiveLimit',
  parentArchived: 'categories.unarchiveParentArchived',
}

/**
 * The category form (docs/features/category.md → Web screens), a compact sheet (DESIGN.md §6):
 * icon + name, the type, the parent category (a picker view); the icon opens an icon-and-colour
 * view. Create, edit, "fix" a rejected op; in edit mode the header holds archive and delete
 * (after a confirm view, only without sub-categories). Opened through `CategoryService.open()`;
 * the shell loads it on first use.
 */
@Component({
  selector: 'app-category-sheet',
  imports: [
    FORM_IMPORTS,
    ReactiveFormsModule,
    TranslocoPipe,
    NgIcon,
    NameIconField,
    SegmentedField,
    ToggleListField,
    IconField,
    ColorField,
    IconBadge,
    HlmButton,
    HlmDrawerImports,
    SheetFrame,
  ],
  providers: [
    provideIcons({
      lucideArchive,
      lucideArchiveRestore,
      lucideCheck,
      lucideChevronRight,
      lucideTrash2,
    }),
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
                @if (editing(); as category) {
                  <div sheetActions class="flex">
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon"
                      type="button"
                      class="size-11"
                      [disabled]="!categoryService.canWrite()"
                      [attr.aria-label]="
                        (category.isArchived ? 'categories.unarchive' : 'categories.archive')
                          | transloco
                      "
                      (click)="toggleArchive()"
                    >
                      <ng-icon
                        [name]="category.isArchived ? 'lucideArchiveRestore' : 'lucideArchive'"
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
                      [disabled]="!categoryService.canWrite() || childCount() > 0"
                      [attr.aria-label]="'categories.delete' | transloco"
                      (click)="view.set('confirmDelete')"
                    >
                      <ng-icon name="lucideTrash2" size="20" aria-hidden="true" />
                    </button>
                  </div>
                }
                <div class="flex flex-col gap-5">
                  @if (!categoryService.canWrite()) {
                    <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {{ 'categories.needsOnline' | transloco }}
                    </p>
                  }
                  @if (refusal()) {
                    <p role="alert" class="text-sm text-destructive">
                      {{ refusal() | transloco }}
                    </p>
                  }
                  <app-name-icon-field
                    [control]="f.name"
                    [label]="'categories.name' | transloco"
                    [icon]="f.icon.value"
                    [color]="f.color.value"
                    [fallback]="defaultIcon"
                    [iconLabel]="'categories.changeIcon' | transloco"
                    (iconClick)="view.set('icons')"
                  />
                  <div class="flex flex-col gap-1">
                    <app-segmented-field
                      [control]="f.type"
                      [label]="'categories.typeLabel' | transloco"
                      [options]="typeOptions()"
                    />
                    @if (typeNote(); as note) {
                      <p class="text-sm text-muted-foreground">{{ note | transloco }}</p>
                    }
                  </div>
                  <div class="-mx-4 flex flex-col border-y border-border">
                    <button
                      type="button"
                      class="flex min-h-12 items-center gap-3 px-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
                      [disabled]="childCount() > 0"
                      (click)="view.set('parent')"
                    >
                      <span class="text-muted-foreground">{{
                        'categories.parent' | transloco
                      }}</span>
                      <span class="min-w-0 flex-1 truncate text-right">
                        {{ parentName() ?? ('categories.parentNone' | transloco) }}
                      </span>
                      <ng-icon
                        name="lucideChevronRight"
                        size="20"
                        class="text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                    @if (walletItems().length > 0) {
                      <button
                        type="button"
                        class="flex min-h-12 items-center gap-3 border-t border-border px-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        (click)="view.set('wallets')"
                      >
                        <span class="text-muted-foreground">{{
                          'categories.usedIn' | transloco
                        }}</span>
                        <span class="min-w-0 flex-1 truncate text-right">
                          @if (usedIn().used === usedIn().total) {
                            {{ 'categories.usedInAll' | transloco }}
                          } @else {
                            {{ 'categories.usedInSome' | transloco: usedIn() }}
                          }
                        </span>
                        <ng-icon
                          name="lucideChevronRight"
                          size="20"
                          class="text-muted-foreground"
                          aria-hidden="true"
                        />
                      </button>
                    }
                  </div>
                  @if (childCount() > 0) {
                    <p class="rounded-xl bg-muted px-4 py-3 text-sm">
                      {{ 'categories.deleteHasChildren' | transloco: { count: childCount() } }}
                    </p>
                  }
                </div>
                <div sheetFooter class="pt-3">
                  <button
                    hlmBtn
                    type="submit"
                    class="h-11 w-full text-base"
                    [disabled]="!categoryService.canWrite()"
                  >
                    {{ 'categories.save' | transloco }}
                  </button>
                </div>
              </app-sheet-frame>
            </form>
          }
          @case ('icons') {
            <app-sheet-frame
              [title]="'categories.iconHeading' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <div class="flex flex-col gap-6">
                <app-color-field
                  [control]="f.color"
                  [label]="'categories.color' | transloco"
                  [colors]="colors"
                />
                <app-icon-field
                  [control]="f.icon"
                  [label]="'categories.icon' | transloco"
                  [groups]="iconGroups"
                  [color]="f.color.value"
                />
              </div>
            </app-sheet-frame>
          }
          @case ('wallets') {
            <app-sheet-frame
              [title]="'categories.usedInHeading' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <app-toggle-list-field
                [control]="f.hiddenIn"
                [label]="'categories.usedInHeading' | transloco"
                [items]="walletItems()"
              />
            </app-sheet-frame>
          }
          @case ('parent') {
            <app-sheet-frame
              [title]="'categories.parent' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <div class="flex flex-col gap-3">
                <p class="text-sm text-muted-foreground">
                  {{ 'categories.parentHint' | transloco }}
                </p>
                <ul
                  class="divide-y divide-border rounded-xl border border-border bg-card"
                  role="listbox"
                  [attr.aria-label]="'categories.parent' | transloco"
                >
                  <li>
                    <button
                      type="button"
                      role="option"
                      class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      [attr.aria-selected]="f.parentId.value === ''"
                      (click)="pickParent('')"
                    >
                      <app-icon-badge [icon]="defaultIcon" color="#475569" />
                      <span class="flex-1">{{ 'categories.parentNoneOption' | transloco }}</span>
                      @if (f.parentId.value === '') {
                        <ng-icon
                          name="lucideCheck"
                          size="20"
                          class="text-brand"
                          aria-hidden="true"
                        />
                      }
                    </button>
                  </li>
                  @for (parent of parentOptions(); track parent.id) {
                    <li>
                      <button
                        type="button"
                        role="option"
                        class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        [attr.aria-selected]="f.parentId.value === parent.id"
                        (click)="pickParent(parent.id)"
                      >
                        <app-icon-badge
                          [icon]="parent.icon"
                          [color]="parent.color"
                          [fallback]="defaultIcon"
                        />
                        <span class="min-w-0 flex-1 truncate">{{ parent.name }}</span>
                        @if (f.parentId.value === parent.id) {
                          <ng-icon
                            name="lucideCheck"
                            size="20"
                            class="text-brand"
                            aria-hidden="true"
                          />
                        }
                      </button>
                    </li>
                  }
                </ul>
              </div>
            </app-sheet-frame>
          }
          @case ('confirmDelete') {
            <app-sheet-frame
              [title]="'categories.delete' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <div class="flex flex-col items-center gap-2 pt-6 text-center">
                <app-icon-badge
                  [icon]="f.icon.value"
                  [color]="f.color.value"
                  [size]="52"
                  [fallback]="defaultIcon"
                />
                <p class="text-base font-semibold">
                  {{ 'categories.deleteHeading' | transloco: { name: editingName() } }}
                </p>
                <p class="text-sm text-muted-foreground">
                  {{ 'categories.deleteText' | transloco }}
                </p>
              </div>
              <div sheetFooter class="pt-3">
                <button
                  hlmBtn
                  variant="destructive"
                  type="button"
                  class="h-11 w-full text-base"
                  (click)="remove()"
                >
                  {{ 'categories.deleteConfirm' | transloco }}
                </button>
              </div>
            </app-sheet-frame>
          }
          @case ('confirmDiscard') {
            <app-sheet-frame
              [title]="'categories.discardHeading' | transloco"
              leadingIcon="back"
              [leadingLabel]="'categories.keepEditing' | transloco"
              (leading)="view.set('form')"
            >
              <p class="text-sm text-muted-foreground">
                {{ 'categories.discardText' | transloco }}
              </p>
              <div sheetFooter class="pt-3">
                <button
                  hlmBtn
                  variant="destructive"
                  type="button"
                  class="h-11 w-full text-base"
                  (click)="finish()"
                >
                  {{ 'categories.discard' | transloco }}
                </button>
              </div>
            </app-sheet-frame>
          }
        }
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class CategorySheet {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  private languageService = inject(LanguageService)
  protected categoryService = inject(CategoryService)
  private walletService = inject(WalletService)
  private profileService = inject(ProfileService)

  protected iconGroups = CATEGORY_ICON_GROUPS
  protected defaultIcon = CATEGORY_DEFAULT_ICON as UserIcon
  protected colors = USER_COLORS
  protected state = this.categoryService.sheet
  protected view = signal<View>('form')
  /** Why the category can't come back from the archive (a translation key). */
  protected refusal = signal<string | null>(null)

  /** The category being edited (edit and fix), null when creating. */
  protected editingId = computed(() => {
    const state = this.state()
    return state && state.mode !== 'create' ? state.id : null
  })
  /** The live category behind an edit (a refused create has none). */
  protected editing = computed(() => {
    const id = this.editingId()
    return id ? this.categoryService.byId(id) : null
  })
  protected editingName = computed(() => this.editing()?.name ?? '')
  /** Live sub-categories: the row keeps its type and parent, and can't be deleted (rules 3–6). */
  protected childCount = computed(() => {
    const id = this.editingId()
    return id ? this.categoryService.childrenOf(id).length : 0
  })
  /** The profile the name must be unique in (rule 2). */
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
        return 'categories.editHeading'
      case 'fix':
        return 'categories.fixHeading'
      default:
        return 'categories.createHeading'
    }
  })
  protected typeOptions = computed<SelectOption[]>(() => {
    this.languageService.language()
    return [
      { value: 'expense', label: this.transloco.translate('categories.expense') },
      { value: 'income', label: this.transloco.translate('categories.income') },
    ]
  })

  private formValue = signal<{ type: string; parentId: string; hiddenIn: readonly string[] }>({
    type: 'expense',
    parentId: '',
    hiddenIn: [],
  })
  /**
   * Rule 13, "ใช้ในกระเป๋า": the profile's open wallets with a switch each; a wallet that hides
   * the chosen parent shows this one off, locked.
   */
  protected walletItems = computed<ToggleListItem[]>(() => {
    const profileId = this.profileId() ?? this.profileService.current()?.id
    if (!profileId) {
      return []
    }
    const parentId = this.formValue().parentId
    this.languageService.language()
    const note = this.transloco.translate('categories.hiddenWithParent')
    return this.walletService.openOf(profileId).map((wallet) => ({
      id: wallet.id,
      label: wallet.name,
      icon: wallet.icon,
      color: userColor(wallet.color),
      fallback: WALLET_DEFAULT_ICON,
      lockedNote: parentId && wallet.hiddenCategoryIds.includes(parentId) ? note : null,
    }))
  })
  protected usedIn = computed(() => {
    const items = this.walletItems()
    const off = this.formValue().hiddenIn
    return {
      used: items.filter((item) => !item.lockedNote && !off.includes(item.id)).length,
      total: items.length,
    }
  })
  /** The type's top-level open categories, without this one (rule 3). */
  protected parentOptions = computed(() =>
    this.categoryService.parents(this.formValue().type as CategoryType, this.editingId())
  )
  protected parentName = computed(() => {
    const id = this.formValue().parentId
    return id ? (this.categoryService.byId(id)?.name ?? null) : null
  })
  protected typeNote = computed(() => {
    if (this.childCount() > 0) {
      return 'categories.typeLocked'
    }
    return this.formValue().parentId ? 'categories.typeFollowsParent' : null
  })

  // An archived category holds no name (rule 2); coming back is checked by `setArchived`.
  private nameFree: ValidatorFn = (control) => {
    const parent = control.parent?.getRawValue() as { type?: string; parentId?: string } | undefined
    return typeof control.value === 'string' &&
      this.editing()?.isArchived !== true &&
      this.categoryService.nameTaken(
        control.value,
        (parent?.type ?? 'expense') as CategoryType,
        parent?.parentId || null,
        this.editingId(),
        this.profileId() ?? undefined
      )
      ? { nameTaken: 'categories.nameTaken' }
      : null
  }

  form: CategoryFormGroup = this.nnfb.group({
    name: [
      '',
      [
        withMessage(Validators.required, 'categories.nameRequired'),
        withMessage(Validators.pattern(/\S/), 'categories.nameRequired'),
        Validators.maxLength(CATEGORY_LIMITS.NAME_MAX),
        this.nameFree,
      ],
    ],
    icon: [CATEGORY_DEFAULT_ICON as string],
    color: [USER_COLORS[0] as string],
    type: ['expense'],
    parentId: [''],
    hiddenIn: this.nnfb.control<string[]>([]),
  })

  /** Unsaved input: swiping or tapping the sheet away asks first (DESIGN.md §6). */
  protected dirty = signal(false)
  protected open = signal(false)

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.dirty.set(this.form.dirty)
      this.refusal.set(null)
      const { type, parentId, hiddenIn } = this.form.getRawValue()
      this.formValue.set({ type, parentId, hiddenIn })
    })
    // Picking an icon is the icon view's answer: back to the form.
    this.form.controls.icon.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.view() === 'icons') {
        this.view.set('form')
      }
    })
    // A parent belongs to one type: another type starts at the top level (rule 4).
    this.form.controls.type.valueChanges.pipe(takeUntilDestroyed()).subscribe((type) => {
      const parentId = this.form.controls.parentId.value
      if (parentId && this.categoryService.byId(parentId)?.type !== type) {
        this.form.controls.parentId.setValue('')
      }
      this.form.controls.name.updateValueAndValidity()
    })
    this.form.controls.parentId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.syncTypeLock()
      this.form.controls.name.updateValueAndValidity()
    })
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

  protected pickParent(id: string): void {
    this.form.controls.parentId.setValue(id)
    this.form.controls.parentId.markAsDirty()
    this.view.set('form')
  }

  protected save(): void {
    const state = this.state()
    if (!state || this.form.invalid || !this.categoryService.canWrite()) {
      return
    }
    const value = this.form.getRawValue()
    const values: CategoryValues = {
      name: value.name,
      icon: value.icon,
      color: value.color,
      type: value.type === 'income' ? 'income' : 'expense',
      parentId: value.parentId || null,
    }
    if (state.mode === 'fix') {
      this.categoryService.save(state.id, values, state.opId, state.profileId, value.hiddenIn)
    } else {
      this.categoryService.save(this.editingId(), values, null, undefined, value.hiddenIn)
    }
    toast.success(
      this.transloco.translate(state.mode === 'create' ? 'categories.created' : 'categories.saved')
    )
    this.finish()
  }

  /**
   * Rule 7: archive (or bring back) at once, with "undo" in the toast; coming back may be refused.
   * Unsaved edits keep the sheet open.
   */
  protected toggleArchive(): void {
    const category = this.editing()
    if (!category) {
      return
    }
    const archived = !category.isArchived
    const children = this.categoryService
      .childrenOf(category.id)
      .filter((child) => child.isArchived !== archived).length
    const refusal = this.categoryService.setArchived(category.id, archived)
    if (refusal) {
      this.refusal.set(REFUSAL_KEYS[refusal])
      return
    }
    const key = !archived
      ? 'categories.unarchived'
      : children > 0
        ? 'categories.archivedWithChildren'
        : 'categories.archived'
    toast(this.transloco.translate(key, { name: category.name, count: children }), {
      action: {
        label: this.transloco.translate('categories.undo'),
        onClick: () => {
          const undone = this.categoryService.setArchived(category.id, !archived)
          if (undone) {
            toast.error(this.transloco.translate(REFUSAL_KEYS[undone]))
          }
        },
      },
    })
    if (!this.form.dirty) {
      this.finish()
    }
  }

  protected remove(): void {
    const id = this.editingId()
    if (id) {
      const name = this.editingName()
      this.categoryService.remove(id)
      toast(this.transloco.translate('categories.deleted', { name }))
    }
    this.finish()
  }

  /** X: asks first when the form holds unsaved input (DESIGN.md §6). */
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

  /** A child's type is its parent's, and a parent with children keeps its type (rule 4). */
  private syncTypeLock(): void {
    const type = this.form.controls.type
    const parentId = this.form.controls.parentId.value
    const parent = parentId ? this.categoryService.byId(parentId) : null
    if (parent && type.value !== parent.type) {
      type.setValue(parent.type, { emitEvent: false })
    }
    const locked = parent !== null || this.childCount() > 0
    if (locked && type.enabled) {
      type.disable({ emitEvent: false })
    } else if (!locked && type.disabled) {
      type.enable({ emitEvent: false })
    }
  }

  private start(state: CategorySheetState): void {
    this.view.set('form')
    this.dirty.set(false)
    this.refusal.set(null)
    if (state.mode === 'create') {
      this.form.reset({
        name: '',
        icon: CATEGORY_DEFAULT_ICON,
        color: USER_COLORS[USER_COLORS.length - 1],
        type: state.type,
        parentId: state.parentId ?? '',
        hiddenIn: [],
      })
    } else if (state.mode === 'fix') {
      this.form.reset({
        ...this.toForm(state.values),
        hiddenIn: this.categoryService.hiddenIn(state.id, state.profileId),
      })
      this.form.markAllAsTouched()
      this.form.markAsDirty()
      this.dirty.set(true)
    } else {
      const category = this.categoryService.byId(state.id)
      if (!category) {
        this.state.set(null)
        return
      }
      this.form.reset({
        ...this.toForm(category),
        hiddenIn: this.categoryService.hiddenIn(category.id, category.profileId),
      })
    }
    const { type, parentId, hiddenIn } = this.form.getRawValue()
    this.formValue.set({ type, parentId, hiddenIn })
    this.syncTypeLock()
  }

  private toForm(values: CategoryValues) {
    return {
      name: values.name,
      icon: values.icon,
      color: userColor(values.color),
      type: values.type,
      parentId: values.parentId ?? '',
    }
  }
}
