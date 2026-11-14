export enum AppEnv {
  PRODUCTION = 'production',
  DEVELOPMENT = 'development',
}

export enum EnvFileName {
  DEVELOPMENT = '.env.dev',
  // `NODE_ENV=production` on this PC is staging's settings (Docker `staging` profile, `npm start`);
  // production's own keys live only in Vercel.
  PRODUCTION = '.env.staging',
}

export type AppResponse<T> = {
  message: string
  timestamp: string
  data?: T
}
