import chalk from 'chalk'

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
  stream.write(`${prefix} ${message}\n`)
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
