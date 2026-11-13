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
import { Slide } from '@/shared/components/slide'
import type { ProfileFormGroup } from './profile-form.type'

type View = 'form' | 'icons' | 'confirmDelete'

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
    Slide,
  ],
  providers: [provideIcons({ lucideTrash2 })],
  template: `
    @let f = form.controls;
    <hlm-drawer [state]="open() ? 'open' : 'closed'" (closed)="finish()">
      <hlm-drawer-content
        *hlmDrawerPortal
        class="mx-auto h-[92dvh] w-full max-w-[480px] overflow-x-clip data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
      >
        <div class="flex min-h-0 flex-1 flex-col" [appSlide]="depth()">
          @switch (view()) {
            @case ('form') {
              <form [formGroup]="form" class="flex min-h-0 flex-1 flex-col" (ngSubmit)="save()">
                <app-sheet-frame
                  [title]="heading() | transloco"
                  [leadingLabel]="'sheet.close' | transloco"
                  (leading)="finish()"
                >
                  @if (editingId()) {
                    <div sheetActions class="flex">
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon"
                        type="button"
                        class="tpn-hit size-9 text-destructive"
                        [disabled]="!profileService.canWrite()"
                        [attr.aria-label]="'profiles.delete' | transloco"
                        (click)="view.set('confirmDelete')"
                      >
                        <ng-icon name="lucideTrash2" size="18" aria-hidden="true" />
                      </button>
                    </div>
                  }
                  <div class="flex flex-col gap-5">
                    @if (!profileService.canWrite()) {
                      <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {{
                          (profileService.serverDown()
                            ? 'sync.serverDownWrite'
                            : 'profiles.needsOnline'
                          ) | transloco
                        }}
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
          }
        </div>
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
  /** How deep the view is: a deeper one slides in from the right, going back from the left. */
  protected depth = computed(() => (this.view() === 'form' ? 0 : 1))

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
   * Rule 8 (category rule 12, transaction rule 9): the confirm step says how many wallets,
   * categories and transactions go with the profile.
   */
  protected deleteText = computed(() => {
    this.languageService.language()
    const id = this.editingId()
    const t = (key: string, params?: object) => this.transloco.translate(`profiles.${key}`, params)
    // [one, many] translation keys and how many go with the profile.
    const counts: [string, string, number][] = [
      ['deleteWallet', 'deleteWallets', id ? this.profileService.walletCount(id) : 0],
      ['deleteCategory', 'deleteCategories', id ? this.profileService.categoryCount(id) : 0],
      [
        'deleteTransaction',
        'deleteTransactions',
        id ? this.profileService.transactionCount(id) : 0,
      ],
      ['deleteRule', 'deleteRules', id ? this.profileService.ruleCount(id) : 0],
      ['deleteDebt', 'deleteDebts', id ? this.profileService.debtCount(id) : 0],
      ['deleteEvent', 'deleteEvents', id ? this.profileService.eventCount(id) : 0],
    ]
    const items = counts
      .filter(([, , count]) => count > 0)
      .map(([one, many, count]) => (count === 1 ? t(one) : t(many, { count })))
    if (items.length === 0) {
      return t('deleteText')
    }
    const list = new Intl.ListFormat(this.languageService.locale(), { type: 'conjunction' })
    return t('deleteTextWith', { items: list.format(items) })
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

  protected open = signal(false)

  constructor() {
    // Picking an icon is the icon view's answer: back to the form.
    this.form.controls.icon.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.view() === 'icons') {
        this.view.set('form')
      }
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

  /** Saved, deleted, ✕, a swipe down, the backdrop or Escape: unsaved input goes (DESIGN.md §6). */
  protected finish(): void {
    this.form.markAsPristine()
    this.state.set(null)
  }

  private start(state: ProfileSheetState): void {
    this.view.set('form')
    if (state.mode === 'create') {
      this.form.reset({ name: '', icon: PROFILE_ICON_NAMES[0], color: USER_COLORS[0] })
      return
    }
    if (state.mode === 'fix') {
      this.form.reset(state.values)
      this.form.markAllAsTouched()
      this.form.markAsDirty()
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
