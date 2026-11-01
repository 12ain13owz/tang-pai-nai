import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import type { ValidatorFn } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideTrash2 } from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { LanguageService } from '@/core/i18n'
import { PROFILE_LIMITS, ProfileService } from '@/core/profile'
import type { ProfileSheetState } from '@/core/profile'
import {
  ColorField,
  FORM_IMPORTS,
  IconField,
  NameIconField,
  withMessage,
} from '@/shared/components/form'
import { PROFILE_ICON_NAMES, USER_COLORS, userColor } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import type { ProfileFormGroup } from './profile-form.type'

type View = 'form' | 'icons' | 'confirmDelete' | 'confirmDiscard'

/**
 * The profile form (docs/features/profile.md → Web screens), a compact sheet (DESIGN.md §6): icon +
 * name, the icon opening an icon-and-colour view. Create, edit, "fix" a rejected op, and delete
 * (header icon) after a confirm view. Opened from anywhere through `ProfileService.open()`; the
 * shell loads it on first use.
 */
@Component({
  selector: 'app-profile-sheet',
  imports: [
    FORM_IMPORTS,
    TranslocoPipe,
    NgIcon,
    NameIconField,
    IconField,
    ColorField,
    HlmButton,
    HlmDrawerImports,
    SheetFrame,
  ],
  providers: [provideIcons({ lucideTrash2 })],
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
                @if (editingId()) {
                  <div sheetActions class="flex">
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon"
                      type="button"
                      class="size-11 text-destructive"
                      [disabled]="!profileService.canWrite()"
                      [attr.aria-label]="'profiles.delete' | transloco"
                      (click)="view.set('confirmDelete')"
                    >
                      <ng-icon name="lucideTrash2" size="20" aria-hidden="true" />
                    </button>
                  </div>
                }
                <div class="flex flex-col gap-5">
                  @if (!profileService.canWrite()) {
                    <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {{ 'profiles.needsOnline' | transloco }}
                    </p>
                  }
                  <app-name-icon-field
                    [control]="f.name"
                    [label]="'profiles.name' | transloco"
                    [icon]="f.icon.value"
                    [color]="f.color.value"
                    [iconLabel]="'profiles.changeIcon' | transloco"
                    (iconClick)="view.set('icons')"
                  />
                </div>
                <div sheetFooter class="pt-3">
                  <button
                    hlmBtn
                    type="submit"
                    class="h-11 w-full text-base"
                    [disabled]="!profileService.canWrite()"
                  >
                    {{ 'profiles.save' | transloco }}
                  </button>
                </div>
              </app-sheet-frame>
            </form>
          }
          @case ('icons') {
            <app-sheet-frame
              [title]="'profiles.iconHeading' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <div class="flex flex-col gap-6">
                <app-color-field
                  [control]="f.color"
                  [label]="'profiles.color' | transloco"
                  [colors]="colors"
                />
                <app-icon-field
                  [control]="f.icon"
                  [label]="'profiles.icon' | transloco"
                  [icons]="icons"
                  [color]="f.color.value"
                />
              </div>
            </app-sheet-frame>
          }
          @case ('confirmDelete') {
            <app-sheet-frame
              [title]="'profiles.delete' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <div class="flex flex-col gap-2">
                <p class="text-base font-semibold">
                  {{ 'profiles.deleteHeading' | transloco: { name: editingName() } }}
                </p>
                <p class="text-sm text-muted-foreground">
                  {{ deleteText() }}
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
                  {{ 'profiles.deleteConfirm' | transloco }}
                </button>
              </div>
            </app-sheet-frame>
          }
          @case ('confirmDiscard') {
            <app-sheet-frame
              [title]="'profiles.discardHeading' | transloco"
              leadingIcon="back"
              [leadingLabel]="'profiles.keepEditing' | transloco"
              (leading)="view.set('form')"
            >
              <p class="text-sm text-muted-foreground">{{ 'profiles.discardText' | transloco }}</p>
              <div sheetFooter class="pt-3">
                <button
                  hlmBtn
                  variant="destructive"
                  type="button"
                  class="h-11 w-full text-base"
                  (click)="discard()"
                >
                  {{ 'profiles.discard' | transloco }}
                </button>
              </div>
            </app-sheet-frame>
          }
        }
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class ProfileSheet {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  private languageService = inject(LanguageService)
  protected profileService = inject(ProfileService)

  protected icons = PROFILE_ICON_NAMES
  protected colors = USER_COLORS
  protected state = this.profileService.sheet
  protected view = signal<View>('form')

  /** The profile being edited (edit and fix), null when creating. */
  protected editingId = computed(() => {
    const state = this.state()
    return state && state.mode !== 'create' ? state.id : null
  })
  protected editingName = computed(() => {
    const id = this.editingId()
    return (id && this.profileService.byId(id)?.name) ?? ''
  })
  /**
   * Rule 8 (and category rule 12): the confirm step says how many wallets and categories go with
   * the profile, and the wallets' transactions.
   */
  protected deleteText = computed(() => {
    this.languageService.language()
    const id = this.editingId()
    const wallets = id ? this.profileService.walletCount(id) : 0
    const categories = id ? this.profileService.categoryCount(id) : 0
    const t = (key: string, params?: object) => this.transloco.translate(`profiles.${key}`, params)
    const walletText = wallets === 1 ? t('deleteWallet') : t('deleteWallets', { count: wallets })
    const categoryText =
      categories === 1 ? t('deleteCategory') : t('deleteCategories', { count: categories })
    if (wallets > 0 && categories > 0) {
      return t('deleteTextBoth', { wallets: walletText, categories: categoryText })
    }
    if (wallets > 0) {
      return t('deleteTextWalletsOnly', { wallets: walletText })
    }
    return categories > 0
      ? t('deleteTextCategoriesOnly', { categories: categoryText })
      : t('deleteText')
  })
  protected heading = computed(() => {
    switch (this.state()?.mode) {
      case 'edit':
        return 'profiles.editHeading'
      case 'fix':
        return 'profiles.fixHeading'
      default:
        return 'profiles.createHeading'
    }
  })

  private nameFree: ValidatorFn = (control) =>
    typeof control.value === 'string' &&
    this.profileService.nameTaken(control.value, this.editingId())
      ? { nameTaken: 'profiles.nameTaken' }
      : null

  form: ProfileFormGroup = this.nnfb.group({
    name: [
      '',
      [
        withMessage(Validators.required, 'profiles.nameRequired'),
        withMessage(Validators.pattern(/\S/), 'profiles.nameRequired'),
        Validators.maxLength(PROFILE_LIMITS.NAME_MAX),
        this.nameFree,
      ],
    ],
    icon: [PROFILE_ICON_NAMES[0] as string],
    color: [USER_COLORS[0] as string],
  })

  /** Unsaved input: swiping or tapping the sheet away asks first (DESIGN.md §6). */
  protected dirty = signal(false)
  protected open = signal(false)

  constructor() {
    // Picking an icon is the icon view's answer: back to the form.
    this.form.controls.icon.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.view() === 'icons') {
        this.view.set('form')
      }
    })
    this.form.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.dirty.set(this.form.dirty))
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

  protected save(): void {
    const state = this.state()
    if (!state || this.form.invalid || !this.profileService.canWrite()) {
      return
    }
    const value = this.form.getRawValue()
    const fixOpId = state.mode === 'fix' ? state.opId : null
    this.profileService.save(
      this.editingId(),
      { name: value.name, icon: value.icon, color: value.color },
      fixOpId
    )
    toast.success(
      this.transloco.translate(state.mode === 'create' ? 'profiles.created' : 'profiles.saved')
    )
    this.finish()
  }

  protected remove(): void {
    const id = this.editingId()
    if (id) {
      // Read before the delete: the profile is gone from the list right after.
      const name = this.editingName()
      this.profileService.remove(id)
      toast(this.transloco.translate('profiles.deleted', { name }))
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

  protected discard(): void {
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

  private finish(): void {
    this.form.markAsPristine()
    this.dirty.set(false)
    this.state.set(null)
  }

  private start(state: ProfileSheetState): void {
    this.view.set('form')
    this.dirty.set(false)
    if (state.mode === 'create') {
      this.form.reset({ name: '', icon: PROFILE_ICON_NAMES[0], color: USER_COLORS[0] })
      return
    }
    if (state.mode === 'fix') {
      this.form.reset(state.values)
      this.form.markAllAsTouched()
      this.form.markAsDirty()
      this.dirty.set(true)
      return
    }
    const profile = this.profileService.byId(state.id)
    if (!profile) {
      this.state.set(null)
      return
    }
    this.form.reset({ name: profile.name, icon: profile.icon, color: userColor(profile.color) })
  }
}
