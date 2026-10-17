// @ts-check
import eslint from '@eslint/js'
import prettier from 'eslint-config-prettier'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import importPlugin from 'eslint-plugin-import-x'
import n from 'eslint-plugin-n'
import security from 'eslint-plugin-security'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

// Shared import/order rule — reused by both the src and scripts rule sets.
/** @type {['error', Record<string, unknown>]} */
const importOrderRule = [
  'error',
  {
    groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index'], 'type'],
    pathGroups: [
      // Match the @/* alias defined in tsconfig.json
      { pattern: '@/**', group: 'internal', position: 'after' },
    ],
    pathGroupsExcludedImportTypes: ['builtin'],
    alphabetize: { order: 'asc', caseInsensitive: true },
    'newlines-between': 'never',
  },
]

// Shared by every `no-restricted-imports` config below. A later config object REPLACES the rule's
// options instead of merging them, so each override must re-include this pattern.
const featureBoundary = {
  group: ['@/features/*/*'],
  message:
    'Import from another feature only via its public API (@/features/<name>), not internal paths.',
}

// Same-folder imports use `./foo`; anything crossing a folder boundary must use the `@/` alias.
// (import-x/no-relative-parent-imports would be the obvious rule, but once a TS resolver is set it
// checks the *resolved* path and flags every `@/` import too, so we match the written specifier.)
const relativeParent = {
  group: ['../*', '../**'],
  message: 'Use the @/ alias instead of a ../ relative import.',
}

// Every `no-restricted-imports` config below must include these (later configs replace, not merge).
const importBoundaries = [featureBoundary, relativeParent]

// Business layer of a feature (entity, repository port, service) must stay framework/DB-agnostic.
// Adapters live in *.controller.ts / *.routes.ts (HTTP) and *.repository.<driver>.ts (DB).
const businessLayerFiles = ['src/features/**/*.{service,entity,repository}.ts']

const businessLayerRestrictedPaths = [
  {
    name: 'express',
    message:
      'Business logic must not depend on HTTP. Keep Express in *.controller.ts / *.routes.ts.',
  },
  {
    name: '@/shared/constants',
    importNames: ['HttpStatus'],
    message:
      'Business logic must not pick HTTP status codes. Throw a domain error (NotFoundError, ConflictError, …) from @/core/error.',
  },
]

// Project DB module + common Node DB clients/ORMs. Add your driver here if it's missing.
const dbClientGroup = [
  '@/core/database',
  '@/core/database/**',
  '@/generated',
  '@/generated/**',
  '@prisma/**',
  'sequelize',
  'sequelize/**',
  'typeorm',
  'typeorm/**',
  'drizzle-orm',
  'drizzle-orm/**',
  '@libsql/client',
  '@libsql/**',
  'knex',
  'mongoose',
  'mongodb',
  'mysql2',
  'mysql2/**',
  'pg',
]

const businessLayerRestrictedPatterns = [
  ...importBoundaries,
  {
    group: dbClientGroup,
    message:
      'Business logic must not depend on the DB. Depend on the repository port (<feature>.repository.ts) and implement it in <feature>.repository.<driver>.ts.',
  },
  {
    group: ['@/core/middleware', '@/core/middleware/*'],
    message: 'Middleware is HTTP plumbing. Wire it in *.routes.ts, not in business logic.',
  },
  {
    group: ['@/shared/constants/http-status*'],
    message:
      'Business logic must not pick HTTP status codes. Throw a domain error (NotFoundError, ConflictError, …) from @/core/error.',
  },
]

// Adapters (AGENTS.md §2): each side talks to its own outside world only.
// Storage adapter (*.repository.<driver>.ts) never touches HTTP.
const storageAdapterFiles = ['src/features/**/*.repository.*.ts']
const storageAdapterRestrictedPaths = [
  {
    name: 'express',
    message:
      'A repository adapter talks to storage only. Keep Express in *.controller.ts / *.routes.ts.',
  },
]

// HTTP adapter (controller / routes / schema) never touches the DB; it goes through the service.
const httpAdapterFiles = ['src/features/**/*.{controller,routes,schema}.ts']
const httpAdapterRestrictedPatterns = [
  ...importBoundaries,
  {
    group: dbClientGroup,
    message:
      'The HTTP layer must not reach the DB directly. Call the service, which uses the repository port.',
  },
]

export default defineConfig(
  // ── Ignores ───────────────────────────────────────────────────────────────
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', '.turbo/**', 'eslint.config.mjs'],
  },

  // ── TypeScript (Node.js / Express backend) ──────────────────────────────────
  {
    files: ['src/**/*.{js,mjs,cjs,ts}'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked, // type-aware rules for stricter linting
      prettier, // MUST be last: turns off ESLint rules that conflict with Prettier
    ],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        // Type-aware linting via the TypeScript project service (recommended over `project`)
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
      'unused-imports': unusedImports,
      // @types/eslint-plugin-security is stale against ESLint 10's Plugin type
      // (eslint-plugin-security itself ships no types) — cast around the mismatch.
      security: /** @type {import('eslint').ESLint.Plugin} */ (security),
      n,
    },
    settings: {
      // Without the TS parser/extension settings + resolver, import-x can neither resolve `@/`
      // paths nor parse the imported .ts files, so graph rules like no-cycle silently pass.
      ...importPlugin.flatConfigs.typescript.settings,
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
    rules: {
      // ═══════════════════════════════════════════════════════════════════════
      // Baseline — safety & correctness. Keep enabled in every project cloned
      // from this template; only relax with a documented reason.
      // ═══════════════════════════════════════════════════════════════════════

      // ── Safety & error handling ──────────────────────────────────────────────
      'no-async-promise-executor': 'error', // unsafe Promise executor functions
      'no-eval': 'error', // disallow eval()
      eqeqeq: 'error', // require === / !== over == / !=
      'no-var': 'error', // block-scoped declarations only
      'prefer-const': 'error', // catch accidental reassignment
      curly: ['error', 'all'], // always require braces around blocks
      '@typescript-eslint/no-floating-promises': 'error', // every Promise must be awaited/handled
      '@typescript-eslint/no-misused-promises': 'error', // catch async fns passed where sync is expected
      '@typescript-eslint/only-throw-error': 'error', // always throw Error instances (type-aware version of no-throw-literal)
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true }, // a `default` catch-all counts as exhaustive
      ],

      // ── Node.js runtime ──────────────────────────────────────────────────────
      'n/no-deprecated-api': 'error', // catch use of deprecated Node.js APIs
      'n/no-extraneous-import': 'error', // imports must be declared in package.json
      'n/no-unsupported-features/node-builtins': ['error', { version: '>=22.0.0' }], // match engines.node

      // ── Security ─────────────────────────────────────────────────────────────
      'security/detect-object-injection': 'warn',

      // ── TypeScript strictness ───────────────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn', // prefer explicit narrowing over `!`
      '@typescript-eslint/no-unnecessary-condition': 'warn', // catch dead branches from bad type narrowing
      '@typescript-eslint/promise-function-async': 'warn', // functions returning a Promise should be async
      // Auto-rewrite type-only imports to `import type` on --fix / save
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': 'off', // delegated to unused-imports below

      // ── Imports ──────────────────────────────────────────────────────────────
      'unused-imports/no-unused-imports': 'error', // auto-remove unused imports on --fix
      'import/no-duplicates': 'error',
      // Auto-import merges types inline (`{ foo, type Bar }`); force them onto a separate `import type` line
      'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
      'import/no-cycle': 'warn', // circular deps between feature/core modules
      // Cross-feature imports go through a feature's public `index.ts`, never its internals
      'no-restricted-imports': ['error', { patterns: importBoundaries }],

      // ═══════════════════════════════════════════════════════════════════════
      // Opinionated — sensible defaults for this template, safe to tune per project.
      // ═══════════════════════════════════════════════════════════════════════

      // ── Logging & environment ────────────────────────────────────────────────
      'no-console': ['error', { allow: ['warn', 'error'] }], // prefer the winston logger
      'no-process-env': 'warn', // read env through the central config module

      // ── Complexity (relaxed for Express handlers) ────────────────────────────
      complexity: ['warn', { max: 15 }],

      '@typescript-eslint/explicit-module-boundary-types': 'off', // implicit return types are fine for handlers
      '@typescript-eslint/require-await': 'off', // async middleware without await is common
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
      ],
      'import/order': importOrderRule,
    },
  },

  // ── Clean Architecture: feature business layer (entity / repository port / service) ──
  // No Express, no DB client, no HTTP status codes. Applies to type-only imports too.
  {
    files: businessLayerFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: businessLayerRestrictedPaths, patterns: businessLayerRestrictedPatterns },
      ],
    },
  },

  // ── Clean Architecture: storage adapter (*.repository.<driver>.ts) — no Express ──
  {
    files: storageAdapterFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: storageAdapterRestrictedPaths, patterns: importBoundaries },
      ],
    },
  },

  // ── Clean Architecture: HTTP adapter (controller / routes / schema) — no DB client ──
  {
    files: httpAdapterFiles,
    rules: {
      'no-restricted-imports': ['error', { patterns: httpAdapterRestrictedPatterns }],
    },
  },

  // ── Node.js scripts (setup, tooling) ────────────────────────────────────────
  {
    files: ['scripts/**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      prettier,
    ],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: './scripts/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
      'unused-imports': unusedImports,
      n,
    },
    rules: {
      'no-console': 'off', // CLI scripts report progress via console
      'no-process-env': 'off',
      'n/no-process-exit': 'off', // CLI scripts legitimately exit with a status code
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
      'unused-imports/no-unused-imports': 'error',
      'import/order': importOrderRule,
    },
  },

  // ── Tests (relaxed for mocks/fixtures) ──────────────────────────────────────
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  }
)
