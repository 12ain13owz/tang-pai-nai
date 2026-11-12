// `npm run dev`: `ng serve` plus a Cloudflare tunnel, so a phone can open the dev app over real
// HTTPS (Secure cookies, service worker) from any network. Needs `cloudflared` on PATH
// (`winget install Cloudflare.cloudflared`).
//
// - Named tunnel (fixed URL): put `TUNNEL_NAME` and `TUNNEL_HOST` in `web/.env.tunnel` (see
//   `.env.tunnel.example`, setup in README) and add the host to `allowedHosts` in `angular.json`.
// - Otherwise a quick tunnel: a random `https://<words>.trycloudflare.com` every run.
//
// Either way nothing else changes per run: `proxy.conf.json` sends the API
// `Origin: http://localhost:4200`, so the API's `WEB_ORIGIN` stays at its default.
import { spawn, spawnSync } from 'node:child_process'

const PORT = 4200
const isWindows = process.platform === 'win32'
const name = process.env.TUNNEL_NAME?.trim()
const host = process.env.TUNNEL_HOST?.trim()

if (spawnSync('cloudflared', ['--version'], { shell: isWindows }).status !== 0) {
  console.error(
    '\n  cloudflared not found. Install it, open a new terminal, then run `npm run dev` again:\n' +
      '    Windows: winget install Cloudflare.cloudflared\n' +
      '    macOS:   brew install cloudflared\n' +
      '  Or use `npm start` for localhost only.\n'
  )
  process.exit(1)
}

const children = []
const run = (command, args, options = {}) => {
  const child = spawn(command, args, { shell: isWindows, ...options })
  children.push(child)
  child.on('exit', (code) => stop(code ?? 0))
  return child
}

let stopping = false
const stop = (code) => {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode !== null) continue
    if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'])
    else child.kill('SIGTERM')
  }
  process.exit(code)
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

const showUrl = (url) =>
  console.log(`\n  📱 Phone: ${url}  (ready once ng serve finishes building)\n`)

run('ng', ['serve', '--port', String(PORT)], { stdio: 'inherit' })

const origin = `http://localhost:${PORT}`
const tunnel = run(
  'cloudflared',
  name
    ? ['tunnel', '--no-autoupdate', 'run', '--url', origin, name]
    : ['tunnel', '--no-autoupdate', '--url', origin]
)

// cloudflared logs to stderr; only its URL (and errors) are worth showing.
let shown = false
tunnel.stderr.setEncoding('utf8')
tunnel.stderr.on('data', (text) => {
  const url = name
    ? /Registered tunnel connection/.test(text) && host && `https://${host}`
    : text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0]
  if (url && !shown) {
    shown = true
    showUrl(url)
  }
  if (/\bERR\b/.test(text)) process.stderr.write(text)
})
