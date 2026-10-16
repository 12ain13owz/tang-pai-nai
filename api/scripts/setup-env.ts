import chalk from 'chalk'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, '..')
const envExamplePath = join(rootDir, '.env.example')
const envDevPath = join(rootDir, '.env.dev')
const envProdPath = join(rootDir, '.env.prod')

function createEnvFile(
  sourcePath: string,
  targetPath: string,
  replace: Record<string, string> = {}
): boolean {
  if (existsSync(targetPath)) {
    console.log(chalk.yellow(`Warning: ${basename(targetPath)} already exists. Skipping creation.`))
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
    createEnvFile(envExamplePath, envDevPath, { NODE_ENV: 'development' })
    createEnvFile(envExamplePath, envProdPath, { NODE_ENV: 'production' })

    console.log(chalk.cyan('\nPlease edit .env.dev and .env.prod with your configuration values.'))
    console.log(chalk.cyan('You can use any text editor (e.g., nano, vim, or VS Code).'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(chalk.red(`Error: Failed to create .env files: ${message}`))
    process.exit(1)
  }
}

setupEnv()
