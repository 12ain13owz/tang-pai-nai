import { Component, computed, input } from '@angular/core'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { glyphColor } from './user-colors'
import { knownIcon, PROFILE_ICONS } from './user-icons'

/** A user-coloured circle with a lucide glyph (DESIGN.md §6 list rows). Decorative. */
@Component({
  selector: 'app-icon-badge',
  imports: [NgIcon],
  providers: [provideIcons(PROFILE_ICONS)],
  host: { 'aria-hidden': 'true', class: 'inline-flex shrink-0' },
  template: `
    <span
      class="flex items-center justify-center rounded-full"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.background-color]="color()"
      [style.color]="glyph()"
    >
      <ng-icon [name]="name()" [size]="iconSize()" />
    </span>
  `,
})
export class IconBadge {
  icon = input.required<string>()
  color = input.required<string>()
  /** Circle diameter in px: 40 in rows, 24 in the header. */
  size = input(40)

  protected name = computed(() => knownIcon(this.icon()))
  protected glyph = computed(() => glyphColor(this.color()))
  protected iconSize = computed(() => `${Math.round(this.size() / 2)}`)
}
