// Vercel Routing Middleware (deploy #17): `/api/*` on the web's own origin goes to the API
// project with the `/api` prefix stripped, like `proxy.conf.json` in dev. The browser sees one
// origin, so the refresh cookie stays first-party. `API_ORIGIN` is set per Vercel environment
// (Production → the API's production URL, Preview → its `develop` URL), so staging and production
// each reach their own API. Not part of the Angular build.
import { rewrite } from '@vercel/functions/middleware'

export const config = { matcher: '/api/:path*' }

export default function middleware(request) {
  const origin = process.env.API_ORIGIN
  if (!origin) {
    return new Response('API_ORIGIN is not set', { status: 502 })
  }
  const url = new URL(request.url)
  const target = new URL(url.pathname.replace(/^\/api/, '') || '/', origin)
  target.search = url.search
  return rewrite(target)
}
