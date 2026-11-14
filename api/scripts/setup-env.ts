import chalk from 'chalk'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, '..')
const envExamplePath = join(rootDir, '.env.example')
const envDevPath = join(rootDir, '.env.dev')
const envStagingPath = join(rootDir, '.env.staging')

// Secrets the app generates for itself (not keys from an outside service). Each env file gets its
// own random values.
const GENERATED_SECRETS = ['JWT_SECRET', 'OTP_PEPPER']

const randomSecret = (): string => randomBytes(32).toString('base64url')

const generatedSecrets = (): Record<string, string> =>
  Object.fromEntries(GENERATED_SECRETS.map((key) => [key, randomSecret()]))

// An env file made before a secret existed gets it added (or filled in when empty), so an
// existing setup keeps working after an upgrade. Other values are left alone.
function fillMissingSecrets(targetPath: string): void {
  let content = readFileSync(targetPath, 'utf-8')
  const added: string[] = []

  for (const key of GENERATED_SECRETS) {
    const line = new RegExp(`^${key}=(.*)$`, 'm').exec(content)
    const value = line?.[1].replace(/^"|"$/g, '').trim()
    if (value) {
      continue
    }
    content = line
      ? content.replace(line[0], `${key}="${randomSecret()}"`)
      : `${content.trimEnd()}\n${key}="${randomSecret()}"\n`
    added.push(key)
  }

  if (added.length > 0) {
    writeFileSync(targetPath, content)
    console.log(chalk.green(`Added ${added.join(', ')} to ${basename(targetPath)}`))
  }
}

/** `KEY=` lines of an env file, with the comment lines right above each one. */
function exampleEntries(content: string): { key: string; lines: string[] }[] {
  const entries: { key: string; lines: string[] }[] = []
  let comments: string[] = []
  for (const line of content.split(/\r?\n/)) {
    const key = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1]
    if (key) {
      entries.push({ key, lines: [...comments, line] })
      comments = []
    } else {
      comments = line.startsWith('#') ? [...comments, line] : []
    }
  }
  return entries
}

// A variable added to .env.example after the file was made is appended with the example's value
// and comment, so the file always lists every setting. Values already there are left alone.
function fillMissingKeys(examplePath: string, targetPath: string): void {
  let content = readFileSync(targetPath, 'utf-8')
  const missing = exampleEntries(readFileSync(examplePath, 'utf-8')).filter(
    ({ key }) => !new RegExp(`^${key}=`, 'm').test(content)
  )
  if (missing.length === 0) {
    return
  }
  const block = missing.map(({ lines }) => lines.join('\n')).join('\n')
  content = `${content.trimEnd()}\n\n# ── Added by \`npm run setup-env\` from .env.example ──\n${block}\n`
  writeFileSync(targetPath, content)
  console.log(
    chalk.green(`Added to ${basename(targetPath)}: ${missing.map(({ key }) => key).join(', ')}`)
  )
}

function createEnvFile(
  sourcePath: string,
  targetPath: string,
  replace: Record<string, string> = {}
): boolean {
  if (existsSync(targetPath)) {
    console.log(
      chalk.yellow(`${basename(targetPath)} already exists: only missing keys are added.`)
    )
    fillMissingKeys(sourcePath, targetPath)
    fillMissingSecrets(targetPath)
    return false
  }

  let content = readFileSync(sourcePath, 'utf-8')

  Object.entries(replace).forEach(([key, value]) => {
    const regex = new RegExp(`${key}=.*`, 'g')
    content = content.replace(regex, `${key}="${value}"`)
  })

  writeFileSync(targetPath, content)
  console.log(chalk.green(`Created ${basename(targetPath)}`))
  return true
}

function setupEnv(): void {
  if (!existsSync(envExamplePath)) {
    console.error(chalk.red('Error: .env.example not found!'))
    process.exit(1)
  }

  try {
    createEnvFile(envExamplePath, envDevPath, { NODE_ENV: 'development', ...generatedSecrets() })
    createEnvFile(envExamplePath, envStagingPath, {
      NODE_ENV: 'production',
      ...generatedSecrets(),
    })

    console.log(
      chalk.cyan('\nPlease edit .env.dev and .env.staging (docs/env.md says what goes where).')
    )
    console.log(chalk.cyan('You can use any text editor (e.g., nano, vim, or VS Code).'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(chalk.red(`Error: Failed to create .env files: ${message}`))
    process.exit(1)
  }
}

setupEnv()
