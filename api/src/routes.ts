import { Router } from 'express'
import { docsRouter } from '@/features/docs'
import { healthRouter } from '@/features/health'
import { todoRouter } from '@/features/todo'

const router = Router()

router.use('/health', healthRouter)
router.use('/todos', todoRouter)
router.use('/docs', docsRouter)

export const mainRoutes = router
