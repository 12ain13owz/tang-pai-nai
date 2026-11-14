/** The part of Cloudflare Turnstile's browser API the bot check uses (auth spec rule 32). */
export interface TurnstileRenderOptions {
  sitekey: string
  theme?: 'light' | 'dark' | 'auto'
  language?: string
  /** `interaction-only`: invisible unless Cloudflare wants a click. */
  appearance?: 'always' | 'execute' | 'interaction-only'
  size?: 'normal' | 'flexible' | 'compact'
  'refresh-expired'?: 'auto' | 'manual' | 'never'
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
  'timeout-callback'?: () => void
  'before-interactive-callback'?: () => void
  'after-interactive-callback'?: () => void
}

export interface Turnstile {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined
  reset(widgetId: string): void
  remove(widgetId: string): void
}

/** Cloudflare asks that the script is loaded from here as is (never bundled or cached). */
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let loading: Promise<Turnstile> | null = null

/** Adds the script once, on the first screen that needs it; a failed load is tried again next time. */
export const loadTurnstile = async (document: Document): Promise<Turnstile> => {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => {
      const turnstile = (document.defaultView as (Window & { turnstile?: Turnstile }) | null)
        ?.turnstile
      if (turnstile) {
        resolve(turnstile)
      } else {
        reject(new Error('Turnstile did not start'))
      }
    }
    script.onerror = () => {
      script.remove()
      reject(new Error('Turnstile did not load'))
    }
    document.head.append(script)
  }).catch((error: unknown) => {
    loading = null
    throw error
  })
  return loading
}
