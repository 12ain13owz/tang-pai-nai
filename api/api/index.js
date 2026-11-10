// Vercel's entry for the API (deploy #17): every request is rewritten here (vercel.json) and
// handled by the Express app compiled by `npm run build`. `npm run dev` / `start` still listen
// through src/main.ts; this file is never run locally.
import { createApp } from '../dist/app.js'

export default createApp()
