import { CdkDrag, CdkDragHandle, CdkDragPlaceholder, CdkDropList } from '@angular/cdk/drag-drop'
import type { CdkDragDrop } from '@angular/cdk/drag-drop'
import { NgTemplateOutlet } from '@angular/common'
import { Component, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideChevronDown,
  lucideChevronRight,
  lucideGripVertical,
  lucidePlus,
  lucideShapes,
} from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { CATEGORY_DEFAULT_ICON, CategoryService } from '@/core/category'
import type { Category, CategoryType } from '@/core/category'
import { ProfileService } from '@/core/profile'
import { EmptyState } from '@/shared/components/empty-state'
import { IconBadge } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'

/**
 * Account › หมวดหมู่ (docs/features/category.md → Web screens): the current profile's categories
 * (the profile shown on top opens the switch sheet), รายจ่าย / รายรับ tabs, parents with their
 * sub-categories, an order mode (rule 10) and the archived ones folded away.
 */
@Component({
  selector: 'app-categories-page',
  imports: [
    NgTemplateOutlet,
    TranslocoPipe,
    NgIcon,
    HlmButton,
    EmptyState,
    IconBadge,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder,
  ],
  providers: [
    provideIcons({
      lucideChevronDown,
      lucideChevronRight,
      lucideGripVertical,
      lucidePlus,
      lucideShapes,
    }),
  ],
  template: `
    <div class="flex flex-col gap-4 p-4">
      @if (profileService.current(); as profile) {
        <button
          type="button"
          class="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 text-left text-card-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-haspopup="dialog"
          [attr.aria-label]="'categories.switchProfile' | transloco: { name: profile.name }"
          (click)="profileService.switchSheet.set(true)"
        >
          <app-icon-badge [icon]="profile.icon" [color]="profile.color" [size]="28" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-sm text-muted-foreground">
              {{ 'categories.profileLabel' | transloco }}
            </span>
            <span class="truncate font-semibold">{{ profile.name }}</span>
          </span>
          <ng-icon
            name="lucideChevronDown"
            size="20"
            class="text-muted-foreground"
            aria-hidden="true"
          />
        </button>
        @if (!categoryService.canWrite()) {
          <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {{ 'categories.needsOnline' | transloco }}
          </p>
        }
        <div class="flex rounded-lg bg-muted p-1" role="tablist">
          @for (tab of tabs; track tab) {
            <button
              type="button"
              role="tab"
              class="flex h-10 flex-1 items-center justify-center rounded-md text-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-selected:bg-card aria-selected:font-semibold aria-selected:text-foreground aria-selected:shadow-sm"
              [attr.aria-selected]="type() === tab"
              (click)="selectType(tab)"
            >
              {{
                'categories.tabCount'
                  | transloco
                    : {
                        label: 'categories.' + tab | transloco,
                        count: categoryService.openCount(tab),
                      }
              }}
            </button>
          }
        </div>

        @if (tree().length > 0) {
          <section class="flex flex-col gap-3" aria-labelledby="categories-heading">
            <div class="flex items-center justify-between gap-3">
              <h2 id="categories-heading" class="text-sm font-medium text-muted-foreground">
                {{ 'categories.listHeading' | transloco }}
              </h2>
              <button
                hlmBtn
                variant="ghost"
                type="button"
                class="-my-3 -mr-2 h-11"
                [attr.aria-pressed]="ordering()"
                [disabled]="!categoryService.canWrite()"
                (click)="ordering.set(!ordering())"
              >
                {{ (ordering() ? 'categories.orderDone' : 'categories.order') | transloco }}
              </button>
            </div>
            <ul
              class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
              cdkDropList
              cdkDropListLockAxis="y"
              [cdkDropListDisabled]="!ordering()"
              (cdkDropListDropped)="dropParent($event)"
            >
              @for (node of tree(); track node.category.id) {
                <li
                  class="bg-card first:rounded-t-xl last:rounded-b-xl"
                  cdkDrag
                  [cdkDragStartDelay]="dragDelay"
                  cdkDragPreviewClass="tpn-drag-preview"
                >
                  <div
                    *cdkDragPlaceholder
                    class="min-h-14 border-2 border-dashed border-border bg-muted"
                  ></div>
                  <ng-container
                    *ngTemplateOutlet="row; context: { $implicit: node.category, child: false }"
                  />
                  @if (node.children.length > 0) {
                    <ul
                      class="divide-y divide-border border-t border-border"
                      cdkDropList
                      cdkDropListLockAxis="y"
                      [cdkDropListDisabled]="!ordering()"
                      (cdkDropListDropped)="dropChild(node.category.id, $event)"
                    >
                      @for (child of node.children; track child.id) {
                        <li
                          class="bg-card"
                          cdkDrag
                          [cdkDragStartDelay]="dragDelay"
                          cdkDragPreviewClass="tpn-drag-preview"
                        >
                          <div
                            *cdkDragPlaceholder
                            class="min-h-12 border-2 border-dashed border-border bg-muted"
                          ></div>
                          <ng-container
                            *ngTemplateOutlet="row; context: { $implicit: child, child: true }"
                          />
                        </li>
                      }
                    </ul>
                  }
                </li>
              }
            </ul>
            @if (ordering()) {
              <p class="text-sm text-muted-foreground">{{ 'categories.orderHint' | transloco }}</p>
            }
          </section>
        } @else {
          <app-empty-state
            [heading]="
              'categories.emptyHeading' | transloco: { label: 'categories.' + type() | transloco }
            "
            [description]="'categories.emptyText' | transloco"
          >
            <ng-icon name="lucideShapes" />
          </app-empty-state>
        }

        @if (!ordering()) {
          @if (!categoryService.atLimit()) {
            <button
              hlmBtn
              [variant]="tree().length === 0 ? 'default' : 'outline'"
              type="button"
              class="h-11 w-full"
              [disabled]="!categoryService.canWrite()"
              (click)="categoryService.open({ mode: 'create', type: type(), parentId: null })"
            >
              <ng-icon name="lucidePlus" size="20" aria-hidden="true" />
              {{ 'categories.add' | transloco }}
            </button>
          } @else {
            <p class="text-sm text-muted-foreground">{{ 'categories.limit' | transloco }}</p>
          }
        }

        @if (archived().length > 0 && !ordering()) {
          <section class="flex flex-col gap-3">
            <button
              type="button"
              class="-ml-2 flex h-11 items-center gap-1 self-start rounded-md px-2 text-sm font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-controls="categories-archived"
              [attr.aria-expanded]="showArchived()"
              (click)="showArchived.set(!showArchived())"
            >
              <ng-icon
                [name]="showArchived() ? 'lucideChevronDown' : 'lucideChevronRight'"
                size="20"
                aria-hidden="true"
              />
              {{ 'categories.archivedHeading' | transloco: { count: archived().length } }}
            </button>
            @if (showArchived()) {
              <ul
                id="categories-archived"
                class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
              >
                @for (item of archived(); track item.category.id) {
                  <li>
                    <ng-container
                      *ngTemplateOutlet="
                        row;
                        context: { $implicit: item.category, child: item.child, archived: true }
                      "
                    />
                  </li>
                }
              </ul>
            }
          </section>
        }
      }
    </div>

    <ng-template #row let-category let-child="child" let-archived="archived">
      <div
        class="flex items-center gap-3 py-2 pr-2"
        [class.min-h-14]="!child"
        [class.min-h-12]="child"
        [class.pl-4]="!child"
        [class.pl-11]="child"
      >
        @if (ordering()) {
          <app-icon-badge
            [icon]="category.icon"
            [color]="category.color"
            [size]="child ? 32 : 40"
            [fallback]="defaultIcon"
          />
          <span class="min-w-0 flex-1 truncate" [class.text-base]="!child">{{
            category.name
          }}</span>
          <button
            hlmBtn
            variant="ghost"
            size="icon"
            type="button"
            class="size-11 touch-none"
            cdkDragHandle
            [attr.aria-label]="'categories.dragItem' | transloco: { name: category.name }"
            (keydown.arrowup)="moveBy($event, category, -1)"
            (keydown.arrowdown)="moveBy($event, category, 1)"
          >
            <ng-icon name="lucideGripVertical" size="20" aria-hidden="true" />
          </button>
        } @else {
          <button
            type="button"
            class="-my-2 -mr-2 flex min-w-0 flex-1 items-center gap-3 self-stretch py-2 pr-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            [attr.aria-label]="'categories.editItem' | transloco: { name: category.name }"
            (click)="categoryService.open({ mode: 'edit', id: category.id })"
          >
            <app-icon-badge
              [icon]="category.icon"
              [color]="category.color"
              [size]="child ? 32 : 40"
              [fallback]="defaultIcon"
            />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate" [class.text-base]="!child">{{ category.name }}</span>
              @if (archived && !child && parentName(category); as parent) {
                <span class="text-sm text-muted-foreground">
                  {{ 'categories.subOf' | transloco: { name: parent } }}
                </span>
              }
              @if (categoryService.pendingIds().has(category.id)) {
                <span class="text-sm text-muted-foreground">
                  {{ 'categories.pending' | transloco }}
                </span>
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
    </ng-template>
  `,
})
export class CategoriesPage {
  private route = inject(ActivatedRoute)
  private router = inject(Router)
  protected profileService = inject(ProfileService)
  protected categoryService = inject(CategoryService)

  protected tabs: readonly CategoryType[] = ['expense', 'income']
  protected defaultIcon = CATEGORY_DEFAULT_ICON as UserIcon
  protected type = signal<CategoryType>('expense')
  protected ordering = signal(false)
  protected showArchived = signal(false)

  protected tree = computed(() => this.categoryService.tree(this.type()))
  /**
   * Archived parents, each followed by its archived children (indented), then archived children
   * of open parents (with "under <parent>").
   */
  protected archived = computed(() => {
    const type = this.type()
    return [
      ...this.categoryService
        .tree(type, true)
        .flatMap((node) => [
          { category: node.category, child: false },
          ...node.children.map((category) => ({ category, child: true })),
        ]),
      ...this.categoryService
        .archivedChildren(type)
        .map((category) => ({ category, child: false })),
    ]
  })

  /** Touch: press and hold the handle before dragging, so scrolling the list still works. */
  protected dragDelay = { touch: 300, mouse: 0 }

  constructor() {
    // "Fix" in the sync sheet opens this page with the rejected op's id.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const fix = params.get('fix')
      if (fix) {
        this.categoryService.openFix(fix)
        void this.router.navigate([], { queryParams: {}, replaceUrl: true })
      }
    })
  }

  protected selectType(type: CategoryType): void {
    this.type.set(type)
  }

  protected parentName(category: Category): string | null {
    return category.parentId ? (this.categoryService.byId(category.parentId)?.name ?? null) : null
  }

  protected dropParent(event: CdkDragDrop<unknown>): void {
    const parent = this.tree().at(event.previousIndex)?.category
    if (parent) {
      this.categoryService.moveTo(parent.id, event.currentIndex)
    }
  }

  protected dropChild(parentId: string, event: CdkDragDrop<unknown>): void {
    const node = this.tree().find((item) => item.category.id === parentId)
    const child = node?.children.at(event.previousIndex)
    if (child) {
      this.categoryService.moveTo(child.id, event.currentIndex)
    }
  }

  /** The handle's keyboard way (DESIGN.md §8: a drag is never the only way). */
  protected moveBy(event: Event, category: Category, step: -1 | 1): void {
    event.preventDefault()
    // The row's place now among its siblings, not the rendered one.
    const siblings =
      category.parentId === null
        ? this.tree().map((node) => node.category)
        : (this.tree().find((node) => node.category.id === category.parentId)?.children ?? [])
    const index = siblings.findIndex((item) => item.id === category.id)
    this.categoryService.moveTo(category.id, index + step)
    const target = event.target
    queueMicrotask(() => target instanceof HTMLElement && target.focus())
  }
}
