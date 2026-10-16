export enum AnsiColors {
  STRING = '38;2;241;250;140', // #F1FA8C
  NUMBER = '38;2;127;255;212', // #7FFFD4
  BOOLEAN = '38;2;250;140;208', // #FA8CD0
  DATE = '38;2;0;180;180', // #00B4B4
  NULL = '38;2;0;64;128', // #004080
  UNDEFINED = '38;2;85;85;85', // #555555
  FIELD = '38;2;121;192;255', // #79C0FF
  FUNCTION = '38;2;210;168;255', // #D2A8FF
  OTHER = '38;2;255;255;255', // #FFFFFF

  ERROR = '38;2;255;59;48', // #FF3B30
  WARN = '38;2;255;149;0', // #FF9500
  INFO = '38;2;52;199;89', // #34C759
  HTTP = '38;2;0;191;255', // #00BFFF
  VERBOSE = '38;2;140;170;230', // #8CAAE6
  DEBUG = '38;2;0;0;255', // #0000FF
}

export enum ErrorSeverity {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  HTTP = 'http',
  VERBOSE = 'verbose',
  DEBUG = 'debug',
}

export const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
} as const

export type LogLevel = keyof typeof LOG_LEVELS
export type DisplayLevel = Uppercase<LogLevel>

export const LOG_LEVEL_COLORS = new Map<DisplayLevel, AnsiColors>([
  ['ERROR', AnsiColors.ERROR],
  ['WARN', AnsiColors.WARN],
  ['INFO', AnsiColors.INFO],
  ['HTTP', AnsiColors.HTTP],
  ['VERBOSE', AnsiColors.VERBOSE],
  ['DEBUG', AnsiColors.DEBUG],
])
