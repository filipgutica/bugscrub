import * as readline from 'node:readline'

import { CliError } from './errors.js'

// Minimal shared arrow-key picker used by interactive CLI flows.
export const promptForChoice = async <T>({
  choices,
  footer,
  title
}: {
  choices: Array<{
    label: string
    value: T
  }>
  footer?: string
  title: string
}): Promise<T> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError({
      message: 'Interactive selection requires a TTY terminal.',
      exitCode: 1
    })
  }

  const input = process.stdin
  const output = process.stdout
  let selectedIndex = 0
  let lineCount = 0
  let rendered = false

  const render = (): void => {
    const lines = [
      title,
      ...choices.map((choice, index) =>
        `${index === selectedIndex ? '\u203a' : ' '} ${choice.label}`
      ),
      footer ?? 'Use up/down arrows and press Enter.'
    ]

    if (rendered) {
      output.write(`\x1b[${lineCount}F`)
    } else {
      output.write('\x1b[?25l')
    }

    for (const line of lines) {
      output.write(`\x1b[2K${line}\n`)
    }

    rendered = true
    lineCount = lines.length
  }

  try {
    readline.emitKeypressEvents(input)

    if (typeof input.setRawMode === 'function') {
      input.setRawMode(true)
    }

    render()

    return await new Promise<T>((resolve, reject) => {
      const onKeypress = (_: string, key: readline.Key): void => {
        if (key.name === 'up') {
          selectedIndex = selectedIndex === 0 ? choices.length - 1 : selectedIndex - 1
          render()
          return
        }

        if (key.name === 'down') {
          selectedIndex = selectedIndex === choices.length - 1 ? 0 : selectedIndex + 1
          render()
          return
        }

        if (key.name === 'return') {
          input.off('keypress', onKeypress)
          resolve(choices[selectedIndex]!.value)
          return
        }

        if (key.ctrl && key.name === 'c') {
          input.off('keypress', onKeypress)
          reject(
            new CliError({
              message: 'Interactive selection was cancelled.',
              exitCode: 1
            })
          )
        }
      }

      input.on('keypress', onKeypress)
    })
  } finally {
    if (typeof input.setRawMode === 'function') {
      input.setRawMode(false)
    }

    if (rendered) {
      output.write(`\x1b[${lineCount}F`)
      for (let index = 0; index < lineCount; index += 1) {
        output.write('\x1b[2K\n')
      }
      output.write(`\x1b[${lineCount}F`)
      output.write('\x1b[?25h')
    }
  }
}
