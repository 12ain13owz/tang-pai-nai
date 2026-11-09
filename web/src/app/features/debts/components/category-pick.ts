import { NgTemplateOutlet } from '@angular/common'
import { Component, computed, inject, input, output } from '@angular/core'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideCheck } from '@ng-icons/lucide'
import { CATEGORY_DEFAULT_ICON, CategoryService } from '@/core/category'
import type { Category, CategoryType } from '@/core/category'
import { IconBadge } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'

/**
 * A sheet view listing a profile's open categories of one type, children in their parent's
 * tinted panel (DESIGN.md §6 Category tree): the instalments', interest's or forgiven rest's.
 */
@Component({
  selector: 'app-debt-category-pick',
  imports: [NgTemplateOutlet, NgIcon, IconBadge],
  providers: [provideIcons({ lucideCheck })],
  template: `
    <ul class="flex flex-col gap-2">
      @for (node of tree(); track node.category.id) {
        <li class="overflow-hidden rounded-xl border border-border bg-card">
          <ng-container
            *ngTemplateOutlet="row; context: { $implicit: node.category, child: false }"
          />
          @if (node.children.length > 0) {
            <ul class="tpn-tree mx-3 mb-3 rounded-lg" [style.--tree-color]="node.category.color">
              @for (child of node.children; track child.id) {
                <li>
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
    <ng-template #row let-category let-child="child">
      <button
        type="button"
        class="flex min-h-13 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
        [attr.aria-current]="category.id === chosen() ? 'true' : null"
        (click)="picked.emit(category.id)"
      >
        <app-icon-badge
          [icon]="category.icon"
          [color]="category.color"
          [fallback]="icon"
          [size]="child ? 32 : 40"
        />
        <span class="min-w-0 flex-1 truncate text-base">{{ category.name }}</span>
        @if (category.id === chosen()) {
          <ng-icon name="lucideCheck" size="20" class="text-brand" aria-hidden="true" />
        }
      </button>
    </ng-template>
  `,
})
export class DebtCategoryPick {
  private categoryService = inject(CategoryService)
  protected icon = CATEGORY_DEFAULT_ICON as UserIcon

  profileId = input.required<string>()
  type = input.required<CategoryType>()
  chosen = input<string | null>(null)
  picked = output<string>()

  protected tree = computed(() =>
    this.categoryService
      .treeOf(this.profileId(), this.type())
      .filter((node) => !node.category.isArchived)
      .map((node) => ({
        category: node.category,
        children: node.children.filter((child: Category) => !child.isArchived),
      }))
  )
}
