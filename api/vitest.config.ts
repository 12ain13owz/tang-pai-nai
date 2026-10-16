import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'development',
      PORT: '3000',
      BASE_URL: 'http://localhost:3000',
      CORS_ORIGINS: '',
      LOG_LEVEL_CONSOLE: 'error',
      LOG_LEVEL_FILE: 'error',
      LOG_LEVEL_ERROR_FILE: 'error',
      LOG_SILENT: 'true',
      SHUTDOWN_TIMEOUT_MS: '10000',
    },
  },
})
