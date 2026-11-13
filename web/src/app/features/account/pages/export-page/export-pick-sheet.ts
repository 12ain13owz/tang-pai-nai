import {
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { LanguageService } from '@/core/i18n'
import { IconBadge } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import type { PickRow } from './export-data'

/** One tab of the picker (categories have รายจ่าย and รายรับ; wallets have one, no tabs). */
export interface PickTab {
  key: string
  label: string
  rows: PickRow[]
}

/** Every id a row stands for: its own and its children's (a parent ticks its children). */
const idsOf = (row: PickRow): string[] => [row.id, ...row.children.map((child) => child.id)]

/**
 * "เลือกบางกระเป๋า" / "เลือกบางหมวด" (docs/features/export.md rule 2, mock-up frame 4): rows with a
 * tick each, children under their parent; a parent with only some ticked shows half ticked.
 * Works on a draft; "เสร็จ" hands the ids back.
 */
@Component({
  selector: 'app-export-pick-sheet',
  imports: [TranslocoPipe, HlmButton, HlmDrawerImports, IconBadge, SheetFrame],
  template: `
    <hlm-drawer [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-drawer-content
        *hlmDrawerPortal
        class="mx-auto h-[92dvh] w-full max-w-[480px] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
      >
        <app-sheet-frame
          [title]="title()"
          [leadingLabel]="'sheet.close' | transloco"
          (leading)="open.set(false)"
        >
          <button
            sheetActions
            hlmBtn
            variant="ghost"
            type="button"
            class="tpn-hit h-9 rounded-full px-3 font-semibold text-brand"
            [disabled]="draft().size === 0"
            (click)="clear()"
          >
            {{ 'export.clear' | transloco }}
          </button>
          <div class="flex flex-col gap-3">
            @if (tabs().length > 1) {
              <div class="flex rounded-xl bg-muted p-1" role="tablist">
                @for (tab of tabs(); track tab.key) {
                  <button
                    type="button"
                    role="tab"
                    class="min-h-10 flex-1 rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    [class]="
                      tab.key === tabKey()
                        ? 'bg-card font-semibold text-foreground shadow-sm'
                        : 'text-muted-foreground'
                    "
                    [attr.aria-selected]="tab.key === tabKey()"
                    (click)="tabKey.set(tab.key)"
                  >
                    {{ tab.label }}
                    @if (tabCount(tab) > 0) {
                      · {{ tabCount(tab) }}
                    }
                  </button>
                }
              </div>
            }
            <ul class="overflow-hidden rounded-2xl border border-border bg-card">
              @for (row of rows(); track row.id) {
                <li class="border-border not-first:border-t">
                  <label class="flex min-h-12 items-center gap-3 px-3">
                    <input
                      type="checkbox"
                      class="size-5 shrink-0 accent-brand"
                      [checked]="state(row) === 'on'"
                      [indeterminate]="state(row) === 'part'"
                      (change)="toggle(row)"
                    />
                    <app-icon-badge [icon]="row.icon" [color]="row.color" [fallback]="fallback()" />
                    <span
                      class="min-w-0 flex-1 truncate"
                      [class.text-muted-foreground]="row.archived"
                    >
                      {{ row.name }}
                      @if (row.archived) {
                        <span class="text-xs"> · {{ 'export.archived' | transloco }}</span>
                      }
                    </span>
                    <span class="text-sm text-muted-foreground tabular-nums">{{
                      number(row.count)
                    }}</span>
                  </label>
                </li>
                @for (child of row.children; track child.id) {
                  <li class="border-t border-border">
                    <label class="flex min-h-12 items-center gap-3 pr-3 pl-10">
                      <input
                        type="checkbox"
                        class="size-5 shrink-0 accent-brand"
                        [checked]="draft().has(child.id)"
                        (change)="toggleOne(child.id)"
                      />
                      <span
                        class="min-w-0 flex-1 truncate"
                        [class.text-muted-foreground]="child.archived"
                      >
                        {{ child.name }}
                        @if (child.archived) {
                          <span class="text-xs"> · {{ 'export.archived' | transloco }}</span>
                        }
                      </span>
                      <span class="text-sm text-muted-foreground tabular-nums">{{
                        number(child.count)
                      }}</span>
                    </label>
                  </li>
                }
              }
            </ul>
          </div>
          <div sheetFooter class="pt-3">
            <button
              hlmBtn
              type="button"
              class="h-11 w-full text-base"
              [disabled]="draft().size === 0"
              (click)="finish()"
            >
              {{ 'export.done' | transloco }}
            </button>
          </div>
        </app-sheet-frame>
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class ExportPickSheet {
  private languageService = inject(LanguageService)

  open = model(false)
  title = input.required<string>()
  tabs = input.required<PickTab[]>()
  /** The ids chosen before (the draft starts on them each time the sheet opens). */
  selected = input<readonly string[]>([])
  fallback = input.required<UserIcon>()
  picked = output<string[]>()

  protected draft = signal(new Set<string>())
  protected tabKey = signal('')
  protected rows = computed(
    () => (this.tabs().find((tab) => tab.key === this.tabKey()) ?? this.tabs().at(0))?.rows ?? []
  )

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => {
          this.draft.set(new Set(this.selected()))
          const first = this.tabs().find((tab) => tab.rows.some((row) => this.state(row) !== 'off'))
          this.tabKey.set((first ?? this.tabs().at(0))?.key ?? '')
        })
      }
    })
  }

  private numberFormat = computed(() => new Intl.NumberFormat(this.languageService.locale()))
  protected number(value: number): string {
    return this.numberFormat().format(value)
  }

  protected state(row: PickRow): 'on' | 'part' | 'off' {
    const draft = this.draft()
    const ids = idsOf(row)
    const ticked = ids.filter((id) => draft.has(id)).length
    return ticked === ids.length ? 'on' : ticked > 0 ? 'part' : 'off'
  }

  protected tabCount(tab: PickTab): number {
    const draft = this.draft()
    return tab.rows.flatMap(idsOf).filter((id) => draft.has(id)).length
  }

  protected toggle(row: PickRow): void {
    const next = new Set(this.draft())
    const on = this.state(row) !== 'on'
    for (const id of idsOf(row)) {
      if (on) {
        next.add(id)
      } else {
        next.delete(id)
      }
    }
    this.draft.set(next)
  }

  protected toggleOne(id: string): void {
    const next = new Set(this.draft())
    if (!next.delete(id)) {
      next.add(id)
    }
    this.draft.set(next)
  }

  protected finish(): void {
    this.picked.emit([...this.draft()])
    this.open.set(false)
  }

  protected clear(): void {
    this.draft.set(new Set())
  }
}
