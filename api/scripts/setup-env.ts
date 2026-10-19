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
const envProdPath = join(rootDir, '.env.prod')

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

function createEnvFile(
  sourcePath: string,
  targetPath: string,
  replace: Record<string, string> = {}
): boolean {
  if (existsSync(targetPath)) {
    console.log(chalk.yellow(`Warning: ${basename(targetPath)} already exists. Skipping creation.`))
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
    createEnvFile(envExamplePath, envProdPath, { NODE_ENV: 'production', ...generatedSecrets() })

    console.log(chalk.cyan('\nPlease edit .env.dev and .env.prod with your configuration values.'))
    console.log(chalk.cyan('You can use any text editor (e.g., nano, vim, or VS Code).'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(chalk.red(`Error: Failed to create .env files: ${message}`))
    process.exit(1)
  }
}

setupEnv()
