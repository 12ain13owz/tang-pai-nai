import SwaggerParser from '@apidevtools/swagger-parser'
import { apiReference } from '@scalar/express-api-reference'
import { Router } from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ApiReferenceConfiguration } from '@scalar/express-api-reference'

const router = Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const specEntryPath = path.resolve(__dirname, 'spec/openapi.yaml')

const scalarConfig: Partial<ApiReferenceConfiguration> = {
  url: '/docs/openapi.json',
  theme: 'default',
  darkMode: true,
  hideClientButton: true,
  hideTestRequestButton: true,
  mcp: { disabled: true },
  telemetry: false,
}

router.get('/openapi.json', async (_req, res, next) => {
  try {
    const bundled = await SwaggerParser.bundle(specEntryPath)
    res.json(bundled)
  } catch (error) {
    next(error)
  }
})

router.use('/', apiReference(scalarConfig))

export const docsRouter = router
