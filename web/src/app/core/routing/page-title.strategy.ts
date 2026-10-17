import { inject, Injectable, signal } from '@angular/core'
import { Title } from '@angular/platform-browser'
import { TitleStrategy } from '@angular/router'
import type { RouterStateSnapshot } from '@angular/router'

/**
 * Exposes the current route's `title` as a signal for the page header, and sets the document title
 * to "<page> · ตังค์ไปไหน".
 */
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private title = inject(Title)
  private readonly APP_NAME = 'ตังค์ไปไหน'

  pageTitle = signal(this.APP_NAME)

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const pageTitle = this.buildTitle(snapshot)
    this.pageTitle.set(pageTitle ?? this.APP_NAME)
    this.title.setTitle(pageTitle ? `${pageTitle} · ${this.APP_NAME}` : this.APP_NAME)
  }
}
