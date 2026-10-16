export type StackFrame = {
  function: string
  file: string
  line: number
  column: number
}

export type Source = {
  function: string
  file: string
  line: number
}

// Matches "at fn (/abs/file.ts:12:34)" and "at /abs/file.ts:12:34".
const STACK_FRAME_PATTERN =
  /^\s*at\s+(?:(?<fn>.+?)\s+\()?(?<file>.+?):(?<line>\d+):(?<column>\d+)\)?\s*$/

// Makes paths relative to the project root so logs stay short and portable.
const toRelativePath = (rawFile: string): string => {
  const file = rawFile.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/')
  const projectRoot = process.cwd().replace(/\\/g, '/')

  if (file.toLowerCase().startsWith(projectRoot.toLowerCase())) {
    return file.slice(projectRoot.length + 1)
  }

  return file
}

const parseStackFrame = (line: string): StackFrame | null => {
  const match = STACK_FRAME_PATTERN.exec(line)
  if (!match?.groups) {
    return null
  }

  const { fn, file, line: lineNumber, column } = match.groups

  return {
    function: fn,
    file: toRelativePath(file),
    line: Number(lineNumber),
    column: Number(column),
  }
}

export const parseStackTrace = (stack?: string): StackFrame[] => {
  if (!stack) {
    return []
  }

  return stack
    .split('\n')
    .slice(1) // Drop the leading "Error: message" line.
    .map(parseStackFrame)
    .filter((frame): frame is StackFrame => frame !== null)
}

export const getCallerSource = (): Source | undefined => {
  const stack = new Error().stack
  if (!stack) {
    return undefined
  }

  const lines = stack.split('\n').slice(1)

  for (const line of lines) {
    // Skip the logger's own frames so `source` points at the real call site.
    if (/[/\\]core[/\\]logger[/\\]/.test(line)) {
      continue
    }

    const frame = parseStackFrame(line)
    if (frame) {
      return { function: frame.function, file: frame.file, line: frame.line }
    }
  }

  return undefined
}
