import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import type { ValidatorFn } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { PROFILE_LIMITS, ProfileService } from '@/core/profile'
import type { ProfileSheetState } from '@/core/profile'
import {
  ColorField,
  FORM_IMPORTS,
  IconField,
  InputField,
  withMessage,
} from '@/shared/components/form'
import { PROFILE_ICON_NAMES, USER_COLORS } from '@/shared/components/icon-badge'
import type { ProfileFormGroup } from './profile-form.type'

type View = 'form' | 'confirmDelete' | 'confirmDiscard'

/**
 * The profile form (docs/features/profile.md → Web screens): create, edit, "fix" a rejected op,
 * and delete after a confirm step. Opened from anywhere through `ProfileService.open()`; the
 * shell loads it on first use.
 */
@Component({
  selector: 'app-profile-sheet',
  imports: [
    FORM_IMPORTS,
    TranslocoPipe,
    InputField,
    IconField,
    ColorField,
    HlmButton,
    HlmDrawerImports,
  ],
  template: `
    @let f = form.controls;
    <hlm-drawer
      [state]="state() ? 'open' : 'closed'"
      [disableClose]="form.dirty"
      (closed)="onClosed()"
    >
      <hlm-drawer-content *hlmDrawerPortal class="mx-auto max-w-[480px]">
        @switch (view()) {
          @case ('form') {
            <form
              [formGroup]="form"
              class="flex max-h-[85vh] flex-col gap-4 px-2 pt-2 pb-4"
              (ngSubmit)="save()"
            >
              <h2 hlmDrawerTitle class="text-lg font-semibold">
                {{ heading() | transloco }}
              </h2>
              <div class="-mx-2 flex flex-col gap-6 overflow-y-auto px-2 pb-1">
                @if (!profileService.canWrite()) {
                  <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {{ 'profiles.needsOnline' | transloco }}
                  </p>
                }
                <app-input-field
                  [control]="f.name"
                  [label]="'profiles.name' | transloco"
                  [placeholder]="'profiles.namePlaceholder' | transloco"
                  autocomplete="off"
                />
                <app-icon-field
                  [control]="f.icon"
                  [label]="'profiles.icon' | transloco"
                  [icons]="icons"
                  [color]="f.color.value"
                />
                <app-color-field
                  [control]="f.color"
                  [label]="'profiles.color' | transloco"
                  [colors]="colors"
                />
              </div>
              <div class="flex flex-col gap-3">
                <button
                  hlmBtn
                  type="submit"
                  class="h-11 w-full text-base"
                  [disabled]="!profileService.canWrite()"
                >
                  {{ 'profiles.save' | transloco }}
                </button>
                @if (editingId()) {
                  <button
                    hlmBtn
                    variant="outline"
                    type="button"
                    class="h-11 w-full text-destructive"
                    [disabled]="!profileService.canWrite()"
                    (click)="view.set('confirmDelete')"
                  >
                    {{ 'profiles.delete' | transloco }}
                  </button>
                }
                <button
                  hlmBtn
                  variant="outline"
                  type="button"
                  class="h-11 w-full"
                  (click)="close()"
                >
                  {{ 'profiles.close' | transloco }}
                </button>
              </div>
            </form>
          }
          @case ('confirmDelete') {
            <div class="flex flex-col gap-6 px-2 pt-2 pb-4">
              <div class="flex flex-col gap-2">
                <h2 hlmDrawerTitle class="text-lg font-semibold">
                  {{ 'profiles.deleteHeading' | transloco: { name: editingName() } }}
                </h2>
                <p class="text-sm text-muted-foreground">
                  {{ 'profiles.deleteText' | transloco }}
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
                  {{ 'profiles.deleteConfirm' | transloco }}
                </button>
                <button
                  hlmBtn
                  variant="outline"
                  type="button"
                  class="h-11 w-full"
                  (click)="view.set('form')"
                >
                  {{ 'profiles.cancel' | transloco }}
                </button>
              </div>
            </div>
          }
          @case ('confirmDiscard') {
            <div class="flex flex-col gap-6 px-2 pt-2 pb-4">
              <h2 hlmDrawerTitle class="text-lg font-semibold">
                {{ 'profiles.discardHeading' | transloco }}
              </h2>
              <div class="flex flex-col gap-3">
                <button
                  hlmBtn
                  variant="destructive"
                  type="button"
                  class="h-11 w-full text-base"
                  (click)="discard()"
                >
                  {{ 'profiles.discard' | transloco }}
                </button>
                <button
                  hlmBtn
                  variant="outline"
                  type="button"
                  class="h-11 w-full"
                  (click)="view.set('form')"
                >
                  {{ 'profiles.keepEditing' | transloco }}
                </button>
              </div>
            </div>
          }
        }
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class ProfileSheet {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
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

  constructor() {
    effect(() => {
      const state = this.state()
      untracked(() => {
        if (state) {
          this.start(state)
        }
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
      this.profileService.remove(id)
      toast(this.transloco.translate('profiles.deleted', { name: this.editingName() }))
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

  protected onClosed(): void {
    this.state.set(null)
  }

  private finish(): void {
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
    this.form.reset({ name: profile.name, icon: profile.icon, color: profile.color })
  }
}
