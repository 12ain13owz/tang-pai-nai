import { Component, computed, inject, input, output, signal } from '@angular/core'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideArrowRight, lucideChevronRight, lucideEyeOff } from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSwitch } from '@spartan-ng/helm/switch'
import { CATEGORY_DEFAULT_ICON, CategoryService } from '@/core/category'
import type { Category, CategoryNode } from '@/core/category'
import { LanguageService } from '@/core/i18n'
import { OfflineService } from '@/core/offline'
import { IconBadge, userColor } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import { moveCategoryRows, moveSources, undoCategoryMove } from './category-move-rows'

type Step = 'choose' | 'target' | 'confirm'

/**
 * "ย้ายรายการ" inside the category sheet (docs/features/export.md rules 7–10, mock-up frames
 * 6–7): from which wallet, to which category, hide the old one there, then confirm. One local
 * write; the toast's เลิกทำ puts it back.
 */
@Component({
  selector: 'app-category-move',
  imports: [TranslocoPipe, NgIcon, HlmButton, HlmSwitch, IconBadge, SheetFrame],
  providers: [provideIcons({ lucideArrowRight, lucideChevronRight, lucideEyeOff })],
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    @switch (step()) {
      @case ('choose') {
        <app-sheet-frame
          [title]="'categories.moveHeading' | transloco"
          leadingIcon="back"
          [leadingLabel]="'sheet.back' | transloco"
          (leading)="back.emit()"
        >
          <div class="flex flex-col gap-5">
            <section class="flex flex-col gap-2" aria-labelledby="move-from">
              <h3 id="move-from" class="text-sm font-medium text-muted-foreground">
                {{ 'categories.moveFrom' | transloco }}
              </h3>
              <div class="divide-y divide-border rounded-xl border border-border bg-card">
                <label class="flex min-h-12 items-center gap-3 px-4">
                  <input
                    type="radio"
                    name="move-from"
                    class="size-5 accent-brand"
                    [checked]="walletId() === null"
                    (change)="walletId.set(null)"
                  />
                  <span class="flex-1">{{ 'categories.moveAllWallets' | transloco }}</span>
                  <span class="text-sm text-muted-foreground tabular-nums">{{
                    number(total())
                  }}</span>
                </label>
                @for (source of sources(); track source.walletId) {
                  <label class="flex min-h-12 items-center gap-3 px-4">
                    <input
                      type="radio"
                      name="move-from"
                      class="size-5 accent-brand"
                      [checked]="walletId() === source.walletId"
                      (change)="walletId.set(source.walletId)"
                    />
                    <span class="min-w-0 flex-1 truncate">{{ source.walletName }}</span>
                    <span class="text-sm text-muted-foreground tabular-nums">{{
                      number(source.count)
                    }}</span>
                  </label>
                }
              </div>
            </section>
            <section class="flex flex-col gap-2" aria-labelledby="move-to">
              <h3 id="move-to" class="text-sm font-medium text-muted-foreground">
                {{ 'categories.moveTo' | transloco }}
              </h3>
              <button
                type="button"
                class="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                (click)="step.set('target')"
              >
                @if (target(); as target) {
                  <app-icon-badge
                    [icon]="target.icon"
                    [color]="target.color"
                    [fallback]="defaultIcon"
                  />
                  <span class="min-w-0 flex-1 truncate">{{ targetName() }}</span>
                } @else {
                  <span class="flex-1 text-muted-foreground">{{
                    'categories.moveChoose' | transloco
                  }}</span>
                }
                <ng-icon
                  name="lucideChevronRight"
                  size="20"
                  class="text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
            </section>
            @if (walletId() !== null) {
              <div
                class="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-4 py-2"
              >
                <ng-icon name="lucideEyeOff" size="20" aria-hidden="true" />
                <span class="flex flex-1 flex-col">
                  <span>{{ 'categories.moveHide' | transloco: { name: category().name } }}</span>
                  <span class="text-xs text-muted-foreground">{{
                    'categories.moveHideHint' | transloco: { wallet: walletName() }
                  }}</span>
                </span>
                <hlm-switch
                  [checked]="hide()"
                  [aria-label]="'categories.moveHide' | transloco: { name: category().name }"
                  (checkedChange)="hide.set($event)"
                />
              </div>
            }
          </div>
          <div sheetFooter class="pt-3">
            <button
              hlmBtn
              type="button"
              class="h-11 w-full text-base"
              [disabled]="!target() || count() === 0 || !categoryService.canWrite()"
              (click)="step.set('confirm')"
            >
              {{ one('categories.moveButton') | transloco: { count: number(count()) } }}
            </button>
          </div>
        </app-sheet-frame>
      }
      @case ('target') {
        <app-sheet-frame
          [title]="'categories.moveTo' | transloco"
          leadingIcon="back"
          [leadingLabel]="'sheet.back' | transloco"
          (leading)="step.set('choose')"
        >
          <ul
            class="divide-y divide-border rounded-xl border border-border bg-card"
            [attr.aria-label]="'categories.moveTo' | transloco"
          >
            @for (node of targets(); track node.category.id) {
              <li>
                @if (node.category.id !== category().id) {
                  <button
                    type="button"
                    class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                    [attr.aria-pressed]="node.category.id === targetId()"
                    (click)="pick(node.category.id)"
                  >
                    <app-icon-badge
                      [icon]="node.category.icon"
                      [color]="node.category.color"
                      [fallback]="defaultIcon"
                    />
                    <span class="min-w-0 flex-1 truncate text-base">{{ node.category.name }}</span>
                  </button>
                } @else {
                  <p class="flex min-h-14 items-center gap-3 px-4 py-2 text-muted-foreground">
                    <app-icon-badge
                      [icon]="node.category.icon"
                      [color]="node.category.color"
                      [fallback]="defaultIcon"
                    />
                    <span class="min-w-0 flex-1 truncate text-base">{{ node.category.name }}</span>
                  </p>
                }
                @if (node.children.length > 0) {
                  <ul
                    class="tpn-tree"
                    [style.--tree-color]="treeColor(node.category.color)"
                    [attr.aria-label]="node.category.name"
                  >
                    @for (child of node.children; track child.id) {
                      <li>
                        <button
                          type="button"
                          class="flex min-h-12 w-full items-center gap-3 py-2 pr-4 pl-7 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                          [attr.aria-pressed]="child.id === targetId()"
                          (click)="pick(child.id)"
                        >
                          <app-icon-badge
                            [icon]="child.icon"
                            [color]="child.color"
                            [fallback]="defaultIcon"
                            [size]="32"
                          />
                          <span class="min-w-0 flex-1 truncate text-base">{{ child.name }}</span>
                        </button>
                      </li>
                    }
                  </ul>
                }
              </li>
            }
          </ul>
        </app-sheet-frame>
      }
      @case ('confirm') {
        <app-sheet-frame
          [title]="'categories.moveHeading' | transloco"
          leadingIcon="back"
          [leadingLabel]="'sheet.back' | transloco"
          (leading)="step.set('choose')"
        >
          @if (target(); as target) {
            <div class="flex flex-col gap-4">
              <div
                class="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
                aria-hidden="true"
              >
                <span class="flex flex-1 flex-col items-center gap-1.5 text-center text-sm">
                  <app-icon-badge
                    [icon]="category().icon"
                    [color]="category().color"
                    [fallback]="defaultIcon"
                  />
                  {{ category().name }}
                  <span class="text-xs text-muted-foreground">{{
                    walletId() === null ? ('categories.moveAllWallets' | transloco) : walletName()
                  }}</span>
                </span>
                <ng-icon name="lucideArrowRight" size="20" class="text-muted-foreground" />
                <span class="flex flex-1 flex-col items-center gap-1.5 text-center text-sm">
                  <app-icon-badge
                    [icon]="target.icon"
                    [color]="target.color"
                    [fallback]="defaultIcon"
                  />
                  {{ targetName() }}
                </span>
              </div>
              <p class="text-base font-semibold">
                {{
                  one('categories.moveQuestion')
                    | transloco: { count: number(count()), from: category().name, to: targetName() }
                }}
              </p>
              @if (walletId() !== null && hide()) {
                <p class="text-sm text-muted-foreground">
                  {{
                    'categories.moveHideNote'
                      | transloco: { name: category().name, wallet: walletName() }
                  }}
                </p>
              }
              <p class="text-sm text-muted-foreground">
                {{ 'categories.moveUndoNote' | transloco }}
              </p>
            </div>
          }
          <div sheetFooter class="flex gap-2 pt-3">
            <button
              hlmBtn
              variant="outline"
              type="button"
              class="h-11 text-base"
              (click)="step.set('choose')"
            >
              {{ 'categories.moveCancel' | transloco }}
            </button>
            <button
              hlmBtn
              type="button"
              class="h-11 flex-1 text-base"
              [disabled]="!categoryService.canWrite()"
              (click)="move()"
            >
              {{ 'categories.moveConfirm' | transloco }}
            </button>
          </div>
        </app-sheet-frame>
      }
    }
  `,
})
export class CategoryMove {
  private transloco = inject(TranslocoService)
  private offlineService = inject(OfflineService)
  private languageService = inject(LanguageService)
  protected categoryService = inject(CategoryService)

  category = input.required<Category>()
  back = output()
  moved = output()

  protected defaultIcon = CATEGORY_DEFAULT_ICON as UserIcon
  protected treeColor = userColor
  protected step = signal<Step>('choose')
  protected walletId = signal<string | null>(null)
  protected targetId = signal<string | null>(null)
  protected hide = signal(false)

  protected sources = computed(() => {
    this.offlineService.changes()
    const id = this.category().id
    return this.offlineService.isOpen() ? moveSources(this.offlineService.db(), id) : []
  })
  protected total = computed(() => this.sources().reduce((sum, source) => sum + source.count, 0))
  protected count = computed(() => {
    const walletId = this.walletId()
    return walletId === null
      ? this.total()
      : (this.sources().find((source) => source.walletId === walletId)?.count ?? 0)
  })
  protected walletName = computed(
    () => this.sources().find((source) => source.walletId === this.walletId())?.walletName ?? ''
  )
  /** Rule 8: open categories of the same type and profile, itself left out (its row is shown). */
  protected targets = computed<CategoryNode[]>(() => {
    const category = this.category()
    return this.categoryService
      .treeOf(category.profileId, category.type)
      .filter((node) => node.category.id !== category.id || node.children.length > 0)
      .map((node) => ({
        ...node,
        children: node.children.filter((child) => child.id !== category.id),
      }))
  })
  protected target = computed<Category | null>(() => {
    const id = this.targetId()
    return id ? this.categoryService.byId(id) : null
  })
  /** "อาหาร › เครื่องดื่ม" for a child, as the pickers show it. */
  protected targetName = computed(() => {
    const target = this.target()
    if (!target) {
      return ''
    }
    const parent = target.parentId ? this.categoryService.byId(target.parentId) : null
    return parent ? `${parent.name} › ${target.name}` : target.name
  })

  private numberFormat = computed(() => new Intl.NumberFormat(this.languageService.locale()))
  protected number(value: number): string {
    return this.numberFormat().format(value)
  }

  /** The `One` key when a single row moves (English counts, web/AGENTS.md → UI text). */
  protected one(key: string): string {
    return this.count() === 1 ? `${key}One` : key
  }

  protected pick(id: string): void {
    this.targetId.set(id)
    this.step.set('choose')
  }

  protected move(): void {
    const targetId = this.targetId()
    if (!targetId || !this.categoryService.canWrite()) {
      return
    }
    const fromId = this.category().id
    const walletId = this.walletId()
    const hide = walletId !== null && this.hide()
    const now = Date.now()
    const done = this.offlineService.write((db) =>
      moveCategoryRows(db, fromId, targetId, walletId, hide, now)
    )
    if (!done) {
      return
    }
    toast(
      this.transloco.translate(done.ids.length === 1 ? 'categories.movedOne' : 'categories.moved', {
        count: this.number(done.ids.length),
      }),
      {
        action: {
          label: this.transloco.translate('transactions.undo'),
          onClick: () => {
            this.offlineService.write((db) => {
              undoCategoryMove(db, done, Date.now())
            })
          },
        },
      }
    )
    this.moved.emit()
  }
}
