import chalk from 'chalk'

// Shared terminal helpers keep human-readable output consistent across commands.
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g

export const stripAnsi = ({
  value
}: {
  value: string
}): string => {
  return value.replace(ANSI_PATTERN, '')
}

export const getTerminalWidth = ({
  fallback = 100,
  maxWidth = 120,
  padding = 2,
  stream = process.stdout
}: {
  fallback?: number
  maxWidth?: number
  padding?: number
  stream?: NodeJS.WriteStream
} = {}): number => {
  const columns = typeof stream.columns === 'number' ? stream.columns : fallback

  return Math.max(40, Math.min(maxWidth, columns - padding))
}

export const wrapTerminalText = ({
  hangingIndent = '',
  initialIndent = '',
  text,
  width
}: {
  hangingIndent?: string
  initialIndent?: string
  text: string
  width: number
}): string[] => {
  if (text.length === 0) {
    return [initialIndent]
  }

  const segments = text.split('\n')
  const lines: string[] = []

  for (const segment of segments) {
    if (segment.length === 0) {
      lines.push('')
      continue
    }

    let remaining = segment.trimEnd()
    let isFirstLine = true

    while (remaining.length > 0) {
      const indent = isFirstLine ? initialIndent : hangingIndent
      const availableWidth = Math.max(12, width - indent.length)

      if (remaining.length <= availableWidth) {
        lines.push(`${indent}${remaining}`)
        break
      }

      const chunk = remaining.slice(0, availableWidth)
      const breakpoint = chunk.lastIndexOf(' ')
      const splitIndex =
        breakpoint > Math.max(4, Math.floor(availableWidth / 4))
          ? breakpoint
          : availableWidth
      const piece = remaining.slice(0, splitIndex).trimEnd()

      lines.push(`${indent}${piece}`)
      remaining = remaining.slice(splitIndex).trimStart()
      isFirstLine = false
    }
  }

  return lines
}

const print = ({
  level,
  message
}: {
  level: 'info' | 'success' | 'warn' | 'error'
  message: string
}): void => {
  const prefix =
    level === 'info'
      ? chalk.blue('bugscrub')
      : level === 'success'
        ? chalk.green('bugscrub')
        : level === 'warn'
          ? chalk.yellow('bugscrub')
          : chalk.red('bugscrub')

  const stream = level === 'error' ? process.stderr : process.stdout
  const prefixPadding = `${'bugscrub'.replace(/./g, ' ')} `
  const wrapped = wrapTerminalText({
    hangingIndent: prefixPadding,
    initialIndent: '',
    text: message,
    width: getTerminalWidth({
      stream
    }) - 'bugscrub '.length
  })

  if (wrapped.length === 0) {
    stream.write(`${prefix}\n`)
    return
  }

  wrapped.forEach((line, index) => {
    if (index === 0) {
      stream.write(`${prefix} ${line}\n`)
      return
    }

    stream.write(`${line}\n`)
  })
}

export const logger = {
  info: (message: string): void => {
    print({ level: 'info', message })
  },
  success: (message: string): void => {
    print({ level: 'success', message })
  },
  warn: (message: string): void => {
    print({ level: 'warn', message })
  },
  error: (message: string): void => {
    print({ level: 'error', message })
  }
}
