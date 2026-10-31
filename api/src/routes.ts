import { Router } from 'express'
import { authRouter } from '@/features/auth'
import { currencyRouter } from '@/features/currency'
import { docsRouter } from '@/features/docs'
import { healthRouter } from '@/features/health'
import '@/features/profile'
import '@/features/sync-probe'
import { syncRouter } from '@/features/sync'
import { todoRouter } from '@/features/todo'

const router = Router()

router.use('/health', healthRouter)
router.use('/auth', authRouter)
router.use('/currencies', currencyRouter)
router.use('/sync', syncRouter)
router.use('/todos', todoRouter)
router.use('/docs', docsRouter)

export const mainRoutes = router
