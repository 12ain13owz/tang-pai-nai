export enum AppEnv {
  PRODUCTION = 'production',
  DEVELOPMENT = 'development',
}

export enum EnvFileName {
  DEVELOPMENT = '.env.dev',
  PRODUCTION = '.env.prod',
}

export type AppResponse<T> = {
  message: string
  timestamp: string
  data?: T
}
