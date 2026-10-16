import { createApp } from '@/app'
import { env } from '@/core/config'
import { startServer } from '@/core/server'

startServer(createApp(), env.PORT)
