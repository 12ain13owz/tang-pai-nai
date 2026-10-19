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
      DATABASE_URL: ':memory:',
      WEB_ORIGIN: 'http://localhost:4200',
      JWT_SECRET: 'test-jwt-secret-test-jwt-secret-0000',
      OTP_PEPPER: 'test-otp-pepper-test-otp-pepper-0000',
    },
  },
})
