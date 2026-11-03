import { inject, Injectable, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { Title } from '@angular/platform-browser'
import { TitleStrategy } from '@angular/router'
import type { RouterStateSnapshot } from '@angular/router'
import { TranslocoService } from '@jsverse/transloco'

/**
 * Route `title`s are translation keys. Exposes the translated title as a signal for the page
 * header, sets the document title to "<page> · ตังค์ไปไหน", and re-translates on a language switch.
 */
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private title = inject(Title)
  private transloco = inject(TranslocoService)
  private snapshot: RouterStateSnapshot | null = null

  pageTitle = signal('')
  /** A page whose title is data (a category's name in Reports) sets it here while it shows. */
  private titleOverride: string | null = null

  constructor() {
    super()
    this.transloco.langChanges$.pipe(takeUntilDestroyed()).subscribe(() => this.render())
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.snapshot = snapshot
    this.render()
  }

  /** Shows `title` instead of the route's until it's set back to null. */
  setOverride(title: string | null): void {
    this.titleOverride = title
    this.render()
  }

  private render(): void {
    const appName = this.transloco.translate('app.name')
    const key = this.snapshot ? this.buildTitle(this.snapshot) : undefined
    const routeTitle: string = key ? this.transloco.translate(key) : appName
    const pageTitle = this.titleOverride ?? routeTitle
    this.pageTitle.set(pageTitle)
    this.title.setTitle(key || this.titleOverride ? `${pageTitle} · ${appName}` : appName)
  }
}
