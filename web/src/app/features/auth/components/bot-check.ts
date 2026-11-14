import type { ElementRef } from '@angular/core'
import {
  afterNextRender,
  Component,
  DestroyRef,
  DOCUMENT,
  inject,
  signal,
  viewChild,
} from '@angular/core'
import { AuthService } from '@/core/auth'
import { LanguageService } from '@/core/i18n'
import { loadTurnstile } from '@/features/auth/turnstile'
import type { Turnstile } from '@/features/auth/turnstile'

/**
 * Cloudflare Turnstile in front of the sign-in calls that send mail or SMS or check a password
 * (auth spec rule 32). Invisible for most people: a checkbox shows only when Cloudflare wants a
 * click. Nothing loads while the API has no site key (local dev).
 *
 * The form awaits `token()` before its call and calls `reset()` after it: a token works once.
 */
@Component({
  selector: 'app-bot-check',
  host: { class: 'flex justify-center', '[class.hidden]': '!visible()' },
  template: `<div #box class="w-full"></div>`,
})
export class BotCheck {
  private document = inject(DOCUMENT)
  private authService = inject(AuthService)
  private languageService = inject(LanguageService)

  private box = viewChild.required<ElementRef<HTMLElement>>('box')
  /** Only while Cloudflare asks for a click; otherwise the widget takes no room. */
  protected visible = signal(false)

  private turnstile: Turnstile | null = null
  private widgetId: string | null = null
  private current: string | null = null
  private waiting: ((token: string | undefined) => void)[] = []
  private setup: Promise<boolean> | null = null
  private destroyed = false

  constructor() {
    // Started at once, so the token is usually ready before the button is pressed.
    afterNextRender(() => void this.ensure())
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true
      if (this.turnstile && this.widgetId !== null) {
        this.turnstile.remove(this.widgetId)
      }
      this.settle(undefined)
    })
  }

  /**
   * The token to send, once Cloudflare has one. `undefined` while the check is off, or when it
   * failed: the request then goes without one and the API's `BOT_CHECK_FAILED` says so.
   */
  async token(): Promise<string | undefined> {
    if (!(await this.ensure()) || this.widgetId === null) {
      return undefined
    }
    if (this.current) {
      return this.current
    }
    return new Promise((resolve) => this.waiting.push(resolve))
  }

  /** A fresh token for the next try: the API has spent the last one. */
  reset(): void {
    this.current = null
    if (!this.destroyed && this.turnstile && this.widgetId !== null) {
      this.turnstile.reset(this.widgetId)
    }
  }

  /** Off (no site key yet, or the script didn't load) is asked again on the next call. */
  private async ensure(): Promise<boolean> {
    this.setup ??= this.start().then((on) => {
      if (!on) {
        this.setup = null
      }
      return on
    })
    return this.setup
  }

  private async start(): Promise<boolean> {
    const { botCheckSiteKey } = await this.authService.providers()
    if (!botCheckSiteKey || this.destroyed) {
      return false
    }
    try {
      this.turnstile = await loadTurnstile(this.document)
    } catch {
      return false
    }
    // Read through a method: the page may have closed while the script loaded.
    if (this.isGone()) {
      return false
    }
    this.widgetId =
      this.turnstile.render(this.box().nativeElement, {
        sitekey: botCheckSiteKey,
        // ThemeService puts `dark` on <html>; reading it keeps that service out of the auth pages.
        theme: this.document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        language: this.languageService.language().id,
        appearance: 'interaction-only',
        size: 'flexible',
        'refresh-expired': 'auto',
        callback: (token) => {
          this.current = token
          this.settle(token)
        },
        'expired-callback': () => (this.current = null),
        'error-callback': () => this.settle(undefined),
        'timeout-callback': () => this.settle(undefined),
        'before-interactive-callback': () => this.visible.set(true),
        'after-interactive-callback': () => this.visible.set(false),
      }) ?? null
    return this.widgetId !== null
  }

  private isGone(): boolean {
    return this.destroyed
  }

  private settle(token: string | undefined): void {
    const waiting = this.waiting
    this.waiting = []
    for (const resolve of waiting) {
      resolve(token)
    }
  }
}
