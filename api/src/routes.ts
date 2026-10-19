import { Router } from 'express'
import { authRouter } from '@/features/auth'
import { docsRouter } from '@/features/docs'
import { healthRouter } from '@/features/health'
import { todoRouter } from '@/features/todo'

const router = Router()

router.use('/health', healthRouter)
router.use('/auth', authRouter)
router.use('/todos', todoRouter)
router.use('/docs', docsRouter)

export const mainRoutes = router
