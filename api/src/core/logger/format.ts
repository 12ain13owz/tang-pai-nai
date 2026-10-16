import dayjs from 'dayjs'
import type { DisplayLevel, LogLevel } from '@/shared/constants'
import { AnsiColors, LOG_LEVEL_COLORS } from '@/shared/constants'

const applyColor = (text: unknown, color: AnsiColors): string => {
  return `\x1b[${color}m${String(text)}\x1b[0m`
}

const formatPrimitiveValue = (value: unknown): string => {
  if (value === null) {
    return applyColor('null', AnsiColors.NULL)
  }
  if (value === undefined) {
    return applyColor('undefined', AnsiColors.UNDEFINED)
  }

  switch (typeof value) {
    case 'string': {
      // Render separators/headers (multi-line uppercase strings) without quotes.
      const isSeparator = /^[\n\r\s=\-_A-Z0-9.]+$/.test(value) && /[\n\r]/.test(value)
      if (isSeparator) {
        return value
      }
      return applyColor(`"${value}"`, AnsiColors.STRING)
    }
    case 'number':
      return applyColor(value, AnsiColors.NUMBER)
    case 'boolean':
      return applyColor(value, AnsiColors.BOOLEAN)
    case 'function':
      return applyColor(value, AnsiColors.FUNCTION)
    default:
      return applyColor(value, AnsiColors.OTHER)
  }
}

const formatDate = (date: Date): string => {
  return applyColor(dayjs(date).format('YYYY-MM-DD HH:mm:ss'), AnsiColors.DATE)
}

const formatArrayValue = (arr: unknown[], indentLevel: number = 0): string => {
  if (arr.length === 0) {
    return '[]'
  }

  const indent = '  '.repeat(indentLevel)
  const nextIndent = '  '.repeat(indentLevel + 1)

  const isPrimitiveArray = arr.every(
    (item) =>
      item === null || item === undefined || ['string', 'number', 'boolean'].includes(typeof item)
  )

  if (isPrimitiveArray && arr.length <= 5) {
    const items = arr.map((item) => formatValue(item, indentLevel + 1)).join(', ')
    return `[${items}]`
  }

  const items = arr.map((item) => `${nextIndent}${formatValue(item, indentLevel + 1)}`)
  return `[\n${items.join(',\n')}\n${indent}]`
}

const formatObjectValue = (obj: Record<string, unknown>, indentLevel: number = 0): string => {
  const entries = Object.entries(obj)
  if (entries.length === 0) {
    return '{}'
  }

  const indent = '  '.repeat(indentLevel)
  const nextIndent = '  '.repeat(indentLevel + 1)

  const formattedEntries = entries.map(([key, value]) => {
    const coloredKey = applyColor(key, AnsiColors.FIELD)
    return `${nextIndent}${coloredKey}: ${formatValue(value, indentLevel + 1)}`
  })

  return `{\n${formattedEntries.join(',\n')}\n${indent}}`
}

export const formatTimestamp = (): string => {
  return applyColor(`[${dayjs().format('HH:mm:ss.SSS')}]`, AnsiColors.OTHER)
}

export const formatLogLevel = (level: LogLevel): string => {
  const normalizedLevel = level.toUpperCase() as DisplayLevel
  const colorCode: AnsiColors = LOG_LEVEL_COLORS.get(normalizedLevel) ?? AnsiColors.OTHER
  return applyColor(normalizedLevel.padEnd(5), colorCode)
}

export const formatValue = (value: unknown, indentLevel: number = 0): string => {
  // Date must be checked before Array/object since it is also an object.
  if (value instanceof Date) {
    return formatDate(value)
  }
  if (Array.isArray(value)) {
    return formatArrayValue(value, indentLevel)
  }
  if (typeof value === 'object' && value !== null) {
    return formatObjectValue(value as Record<string, unknown>, indentLevel)
  }

  return formatPrimitiveValue(value)
}

export const formatLogMessage = (message: unknown): string => {
  if (Array.isArray(message)) {
    if (message.length === 0) {
      return '[]'
    }
    if (message.length === 1) {
      return formatValue(message[0], 0)
    }

    const formattedItems = message.map((item, index) => {
      const itemNumber = applyColor(`[${index}]`, AnsiColors.OTHER)
      return `  ${itemNumber} ${formatValue(item, 1)}`
    })

    return `\n${formattedItems.join('\n')}`
  }

  return formatValue(message, 0)
}
