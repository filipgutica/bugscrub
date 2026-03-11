import { createRequire } from 'node:module'

import chalk from 'chalk'
import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'

import { getTerminalWidth, wrapTerminalText } from '../utils/logger.js'

const require = createRequire(import.meta.url)
const parseDiff = require('parse-diff') as typeof import('parse-diff')

const markdown = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: false,
  typographer: false
})

const NOISY_DIFF_FILE_PATTERNS = [
  /(?:^|\/)(?:dist|build|coverage)\//i,
  /\.(?:map|min\.(?:css|js))$/i,
  /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i
] as const

type TranscriptFormattingState = {
  diffBuffer: {
    inHunk: boolean
    lines: string[]
  } | undefined
  markdownLines: string[]
}

const isNoisyDiffFile = ({
  path
}: {
  path: string | undefined
}): boolean => {
  return path
    ? NOISY_DIFF_FILE_PATTERNS.some((pattern) => pattern.test(path))
    : false
}

const looksGeneratedOrMinified = ({
  line,
  width
}: {
  line: string
  width: number
}): boolean => {
  if (line.length < width * 2) {
    return false
  }

  const whitespaceCount = [...line].filter((character) => /\s/.test(character)).length
  const punctuationCount = [...line].filter((character) =>
    /[{}()[\].,;:=<>/+*-]/.test(character)
  ).length

  return whitespaceCount < line.length / 20 && punctuationCount >= 8
}

const truncateDisplayLine = ({
  line,
  width
}: {
  line: string
  width: number
}): string => {
  const previewWidth = Math.max(24, width - ' ... [truncated for display]'.length)

  if (line.length <= previewWidth) {
    return line
  }

  return `${line.slice(0, previewWidth).trimEnd()} ... [truncated for display]`
}

const wrapStyledText = ({
  hangingIndent = '',
  initialIndent = '',
  style,
  text,
  width
}: {
  hangingIndent?: string
  initialIndent?: string
  style: (value: string) => string
  text: string
  width: number
}): string[] => {
  return wrapTerminalText({
    hangingIndent,
    initialIndent,
    text,
    width
  }).map((segment) => style(segment))
}

const renderStatusLine = ({
  line,
  width
}: {
  line: string
  width: number
}): string[] => {
  const lower = line.toLowerCase()

  if (line === 'codex' || line === 'claude') {
    return wrapStyledText({
      style: chalk.bold.blue,
      text: line,
      width
    })
  }

  if (
    lower.includes('error') ||
    lower.includes('failed') ||
    lower.includes('fatal') ||
    lower.startsWith('err:')
  ) {
    return wrapStyledText({
      style: chalk.red,
      text: line,
      width
    })
  }

  if (lower.includes('warning') || lower.startsWith('warn:')) {
    return wrapStyledText({
      style: chalk.yellow,
      text: line,
      width
    })
  }

  if (line === 'exec' || line === 'file update:' || line === 'tokens used') {
    return wrapStyledText({
      style: chalk.bold.magenta,
      text: line,
      width
    })
  }

  if (line.startsWith('bugscrub ')) {
    const wrapped = wrapTerminalText({
      hangingIndent: '         ',
      initialIndent: '',
      text: line.slice('bugscrub '.length),
      width: width - 'bugscrub '.length
    })

    return wrapped.map((segment, index) =>
      index === 0 ? `${chalk.blue('bugscrub')} ${segment}` : `         ${segment}`
    )
  }

  if (line.startsWith('/bin/') || line.startsWith('.bugscrub/') || line.startsWith('index ')) {
    return wrapStyledText({
      style: chalk.gray,
      text: line,
      width
    })
  }

  return wrapStyledText({
    style: (value) => value,
    text:
      looksGeneratedOrMinified({
        line,
        width
      })
        ? truncateDisplayLine({
            line,
            width
          })
        : line,
    width
  })
}

const isStandaloneStatusLine = ({
  line
}: {
  line: string
}): boolean => {
  const lower = line.toLowerCase()

  return (
    line === 'codex' ||
    line === 'claude' ||
    line === 'exec' ||
    line === 'file update:' ||
    line === 'tokens used' ||
    line.startsWith('bugscrub ') ||
    line.startsWith('/bin/') ||
    line.startsWith('.bugscrub/') ||
    line.startsWith('index ') ||
    lower.includes('error') ||
    lower.includes('failed') ||
    lower.includes('fatal') ||
    lower.startsWith('err:') ||
    lower.includes('warning') ||
    lower.startsWith('warn:')
  )
}

const renderInlineToken = ({
  token
}: {
  token: Token
}): string => {
  if (!token.children || token.children.length === 0) {
    return token.content
  }

  return token.children
    .map((child) => {
      if (child.type === 'code_inline') {
        return `\`${child.content}\``
      }

      if (child.type === 'softbreak' || child.type === 'hardbreak') {
        return '\n'
      }

      return child.content
    })
    .join('')
}

const renderPlainWrappedText = ({
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
  return wrapTerminalText({
    hangingIndent,
    initialIndent,
    text,
    width
  })
}

const renderCodeFence = ({
  code,
  info,
  indent,
  width
}: {
  code: string
  info: string
  indent: string
  width: number
}): string[] => {
  const codeLines = code.endsWith('\n') ? code.slice(0, -1).split('\n') : code.split('\n')
  const lines = [
    ...wrapStyledText({
      initialIndent: indent,
      style: chalk.gray,
      text: `\`\`\`${info}`.trimEnd(),
      width
    })
  ]

  for (const codeLine of codeLines) {
    lines.push(
      ...wrapStyledText({
        hangingIndent: `${indent}  `,
        initialIndent: `${indent}  `,
        style: chalk.gray,
        text: codeLine,
        width
      })
    )
  }

  lines.push(
    ...wrapStyledText({
      initialIndent: indent,
      style: chalk.gray,
      text: '```',
      width
    })
  )

  return lines
}

const renderList = ({
  depth,
  startIndex,
  tokens,
  width
}: {
  depth: number
  startIndex: number
  tokens: Token[]
  width: number
}): {
  lines: string[]
  nextIndex: number
} => {
  const lines: string[] = []
  const openToken = tokens[startIndex]!
  const isOrdered = openToken.type === 'ordered_list_open'
  const closeType = isOrdered ? 'ordered_list_close' : 'bullet_list_close'
  let itemNumber = Number(openToken.attrGet('start') ?? '1')
  let index = startIndex + 1

  while (index < tokens.length && tokens[index]?.type !== closeType) {
    const token = tokens[index]!

    if (token.type !== 'list_item_open') {
      index += 1
      continue
    }

    const marker = isOrdered ? `${itemNumber}.` : '-'
    itemNumber += 1
    const baseIndent = '  '.repeat(depth)
    const contentIndent = `${baseIndent}${' '.repeat(Math.max(1, marker.length))}`
    let usedMarker = false

    index += 1

    while (index < tokens.length && tokens[index]?.type !== 'list_item_close') {
      const current = tokens[index]!

      if (current.type === 'paragraph_open') {
        const inlineToken = tokens[index + 1]!
        lines.push(
          ...renderPlainWrappedText({
            hangingIndent: usedMarker ? contentIndent : contentIndent,
            initialIndent: usedMarker ? contentIndent : `${baseIndent}${marker} `,
            text: renderInlineToken({
              token: inlineToken
            }),
            width
          })
        )
        usedMarker = true
        index += 3
        continue
      }

      if (current.type === 'fence' || current.type === 'code_block') {
        lines.push(
          ...renderCodeFence({
            code: current.content,
            indent: usedMarker ? contentIndent : `${baseIndent}${marker} `,
            info: current.info ?? '',
            width
          })
        )
        usedMarker = true
        index += 1
        continue
      }

      if (current.type === 'bullet_list_open' || current.type === 'ordered_list_open') {
        const nested = renderList({
          depth: depth + 1,
          startIndex: index,
          tokens,
          width
        })
        lines.push(...nested.lines)
        usedMarker = true
        index = nested.nextIndex
        continue
      }

      index += 1
    }

    if (!usedMarker) {
      lines.push(`${baseIndent}${marker}`)
    }

    index += 1
  }

  return {
    lines,
    nextIndex: index + 1
  }
}

const renderMarkdownBlock = ({
  text,
  width
}: {
  text: string
  width: number
}): string[] => {
  if (text.trim().length === 0) {
    return text.length === 0 ? [] : text.split('\n').map(() => '')
  }

  const tokens = markdown.parse(text, {}) as Token[]
  const lines: string[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!

    if (token.type === 'heading_open') {
      const inlineToken = tokens[index + 1]!
      const style = token.tag === 'h1' ? chalk.bold.cyan : chalk.bold
      lines.push(
        ...wrapStyledText({
          style,
          text: `${'#'.repeat(Number(token.tag.slice(1)))} ${renderInlineToken({
            token: inlineToken
          })}`,
          width
        })
      )
      index += 2
      continue
    }

    if (token.type === 'paragraph_open') {
      const inlineToken = tokens[index + 1]!
      lines.push(
        ...renderPlainWrappedText({
          text: renderInlineToken({
            token: inlineToken
          }),
          width
        })
      )
      index += 2
      continue
    }

    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const rendered = renderList({
        depth: 0,
        startIndex: index,
        tokens,
        width
      })
      lines.push(...rendered.lines)
      index = rendered.nextIndex - 1
      continue
    }

    if (token.type === 'fence' || token.type === 'code_block') {
      lines.push(
        ...renderCodeFence({
          code: token.content,
          info: token.info ?? '',
          indent: '',
          width
        })
      )
    }
  }

  return lines
}

const renderMarkdownSection = ({
  lines,
  width
}: {
  lines: string[]
  width: number
}): string[] => {
  const rendered: string[] = []
  const markdownBuffer: string[] = []

  const flushMarkdownBuffer = () => {
    if (markdownBuffer.length === 0) {
      return
    }

    rendered.push(
      ...renderMarkdownBlock({
        text: markdownBuffer.join('\n'),
        width
      })
    )
    markdownBuffer.length = 0
  }

  for (const line of lines) {
    if (isStandaloneStatusLine({ line })) {
      flushMarkdownBuffer()
      rendered.push(
        ...renderStatusLine({
          line,
          width
        })
      )
      continue
    }

    markdownBuffer.push(line)
  }

  flushMarkdownBuffer()

  return rendered
}

const renderDiffSection = ({
  text,
  width
}: {
  text: string
  width: number
}): string[] => {
  const files = parseDiff(text)

  if (files.length === 0) {
    return text.split('\n').flatMap((line) =>
      renderStatusLine({
        line,
        width
      })
    )
  }

  const rendered: string[] = []
  const formatDiffPath = (path: string) => (path === '/dev/null' ? path : path.startsWith('a/') || path.startsWith('b/') ? path : `a/${path}`)
  const formatNewDiffPath = (path: string) => (path === '/dev/null' ? path : path.startsWith('a/') || path.startsWith('b/') ? path : `b/${path}`)
  const formatHunkCount = (count: number) => (count === 1 ? '' : `,${count}`)

  for (const file of files) {
    const from = formatDiffPath(file.from ?? '/dev/null')
    const to = formatNewDiffPath(file.to ?? '/dev/null')
    const displayPath = (to !== '/dev/null' ? to : from).replace(/^[ab]\//, '')
    const isNoisy = isNoisyDiffFile({
      path: displayPath
    })

    rendered.push(
      ...wrapStyledText({
        style: chalk.bold.yellow,
        text: `diff --git ${from} ${to}`,
        width
      })
    )

    if (file.index && file.index.length > 0) {
      rendered.push(
        ...wrapStyledText({
          style: chalk.gray,
          text: `index ${file.index.join(' ')}`,
          width
        })
      )
    }

    rendered.push(
      ...wrapStyledText({
        style: chalk.red,
        text: `--- ${from}`,
        width
      }),
      ...wrapStyledText({
        style: chalk.green,
        text: `+++ ${to}`,
        width
      })
    )

    if (isNoisy) {
      for (const chunk of file.chunks) {
        const chunkHeader = chunk.content.startsWith('@@')
          ? chunk.content
          : `@@ -${chunk.oldStart}${formatHunkCount(chunk.oldLines)} +${chunk.newStart}${formatHunkCount(chunk.newLines)} @@${chunk.content ? ` ${chunk.content}` : ''}`
        rendered.push(
          ...wrapStyledText({
            style: chalk.cyan,
            text: chunkHeader,
            width
          })
        )
      }
      rendered.push(
        chalk.gray(`... generated diff content for ${displayPath} truncated for display`)
      )
      continue
    }

    for (const chunk of file.chunks) {
      const chunkHeader = chunk.content.startsWith('@@')
        ? chunk.content
        : `@@ -${chunk.oldStart}${formatHunkCount(chunk.oldLines)} +${chunk.newStart}${formatHunkCount(chunk.newLines)} @@${chunk.content ? ` ${chunk.content}` : ''}`
      rendered.push(
        ...wrapStyledText({
          style: chalk.cyan,
          text: chunkHeader,
          width
        })
      )

      for (const change of chunk.changes) {
        if (change.type === 'add') {
          rendered.push(
            ...wrapStyledText({
              hangingIndent: ' ',
              initialIndent: '+',
              style: chalk.green,
              text:
                looksGeneratedOrMinified({
                  line: change.content,
                  width
                })
                  ? truncateDisplayLine({
                      line: change.content.slice(1),
                      width
                    })
                  : change.content.slice(1),
              width
            })
          )
          continue
        }

        if (change.type === 'del') {
          rendered.push(
            ...wrapStyledText({
              hangingIndent: ' ',
              initialIndent: '-',
              style: chalk.red,
              text:
                looksGeneratedOrMinified({
                  line: change.content,
                  width
                })
                  ? truncateDisplayLine({
                      line: change.content.slice(1),
                      width
                    })
                  : change.content.slice(1),
              width
            })
          )
          continue
        }

        rendered.push(
          ...wrapStyledText({
            style: chalk.gray,
            text: change.content,
            width
          })
        )
      }
    }
  }

  return rendered
}

const isDiffContinuationLine = ({
  inHunk,
  line
}: {
  inHunk: boolean
  line: string
}): boolean => {
  return (
    line.length === 0 ||
    line.startsWith('diff --git ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('@@') ||
    line.startsWith('new file mode ') ||
    line.startsWith('deleted file mode ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('old mode ') ||
    line.startsWith('new mode ') ||
    line.startsWith('copy from ') ||
    line.startsWith('copy to ') ||
    line.startsWith('Binary files ') ||
    line.startsWith('GIT binary patch') ||
    (inHunk && /^[ +\\-]/.test(line))
  )
}

const createTranscriptFormattingState = (): TranscriptFormattingState => ({
  diffBuffer: undefined,
  markdownLines: []
})

export const createTranscriptFormatter = ({
  width = getTerminalWidth()
}: {
  width?: number
} = {}) => {
  const state = createTranscriptFormattingState()

  const flushMarkdown = (): string[] => {
    if (state.markdownLines.length === 0) {
      return []
    }

    const lines = renderMarkdownSection({
      lines: state.markdownLines,
      width
    })
    state.markdownLines = []
    return lines
  }

  const flushDiff = (): string[] => {
    if (!state.diffBuffer || state.diffBuffer.lines.length === 0) {
      state.diffBuffer = undefined
      return []
    }

    const lines = renderDiffSection({
      text: state.diffBuffer.lines.join('\n'),
      width
    })
    state.diffBuffer = undefined
    return lines
  }

  const formatText = ({
    flush = false,
    stderr,
    text
  }: {
    flush?: boolean
    stderr: boolean
    text: string
  }): string[] => {
    if (stderr) {
      const rendered = text.split('\n').flatMap((line) =>
        wrapStyledText({
          style: chalk.gray,
          text:
            looksGeneratedOrMinified({
              line,
              width
            })
              ? truncateDisplayLine({
                  line,
                  width
                })
              : line,
          width
        })
      )

      return flush ? rendered : rendered
    }

    const rendered: string[] = []

    for (const line of text.split('\n')) {
      if (state.diffBuffer) {
        if (
          isDiffContinuationLine({
            inHunk: state.diffBuffer.inHunk,
            line
          })
        ) {
          state.diffBuffer.lines.push(line)
          if (line.startsWith('@@')) {
            state.diffBuffer.inHunk = true
          }
          continue
        }

        rendered.push(...flushDiff())
      }

      if (line.startsWith('diff --git ')) {
        rendered.push(...flushMarkdown())
        state.diffBuffer = {
          inHunk: false,
          lines: [line]
        }
        continue
      }

      state.markdownLines.push(line)
    }

    if (flush) {
      rendered.push(...flushDiff(), ...flushMarkdown())
    }

    return rendered
  }

  return {
    formatText
  }
}

export const renderTranscriptText = ({
  stderr,
  text,
  width
}: {
  stderr: boolean
  text: string
  width?: number
}): string => {
  const formatter = createTranscriptFormatter({
    ...(width ? { width } : {})
  })

  return formatter
    .formatText({
      flush: true,
      stderr,
      text
    })
    .join('\n')
}

export const createTranscriptRenderer = () => {
  const formatter = createTranscriptFormatter()
  let stdoutBuffer = ''
  let stderrBuffer = ''

  const flushBuffer = ({
    buffer,
    stderr
  }: {
    buffer: string
    stderr: boolean
  }): string => {
    const lines = buffer.split('\n')
    const remainder = lines.pop() ?? ''
    const completedText = lines.join('\n')

    if (completedText.length > 0) {
      const stream = stderr ? process.stderr : process.stdout

      formatter
        .formatText({
          stderr,
          text: completedText
        })
        .forEach((formatted) => {
          stream.write(`${formatted}\n`)
        })
    }

    return remainder
  }

  return {
    flush: (): void => {
      formatter
        .formatText({
          flush: true,
          stderr: false,
          text: stdoutBuffer
        })
        .forEach((formatted) => {
          process.stdout.write(`${formatted}\n`)
        })
      stdoutBuffer = ''

      formatter
        .formatText({
          flush: true,
          stderr: true,
          text: stderrBuffer
        })
        .forEach((formatted) => {
          process.stderr.write(`${formatted}\n`)
        })
      stderrBuffer = ''
    },
    pushStderr: (chunk: string): void => {
      stderrBuffer += chunk
      stderrBuffer = flushBuffer({
        buffer: stderrBuffer,
        stderr: true
      })
    },
    pushStdout: (chunk: string): void => {
      stdoutBuffer += chunk
      stdoutBuffer = flushBuffer({
        buffer: stdoutBuffer,
        stderr: false
      })
    }
  }
}
