import { join } from 'node:path'

import { CliError } from '../utils/errors.js'
import { runContainerCommand, runShellInContainer } from './docker.js'
import {
  CHROME_DEVTOOLS_MCP_COMMAND,
  CONTAINER_CHROME_WRAPPER_PATH,
  type ContainerExecutionTarget,
  shellQuote
} from './shared.js'

export const isChromeDevtoolsMcpConfigured = ({
  output
}: {
  output: string
}): boolean => {
  const exists =
    output.includes('chrome-devtools') &&
    !/not found|unknown|No MCP server/i.test(output)

  if (!exists) {
    return false
  }

  return /command:\s+(?:.*\/)?chrome-devtools-mcp\b/m.test(output)
}

export const buildChromeDevtoolsBrowserPreflightScript = ({
  logPath
}: {
  logPath: string
}): string => {
  return [
    'set -eu',
    `LOG_PATH=${shellQuote(logPath)}`,
    `CHROME_PATH=${shellQuote(CONTAINER_CHROME_WRAPPER_PATH)}`,
    'mkdir -p "$(dirname "$LOG_PATH")"',
    ': > "$LOG_PATH"',
    'if ! command -v chrome-devtools-mcp >/dev/null 2>&1; then',
    `  printf '%s\\n' 'chrome-devtools-mcp is not installed in the container PATH.' >> "$LOG_PATH"`,
    '  exit 1',
    'fi',
    'if [ ! -x "$CHROME_PATH" ]; then',
    `  printf '%s\\n' "Chrome wrapper not found at $CHROME_PATH." >> "$LOG_PATH"`,
    '  exit 1',
    'fi',
    'PROFILE_DIR="$(mktemp -d /tmp/bugscrub-chrome-profile.XXXXXX)"',
    'PID=""',
    'cleanup() {',
    '  if [ -n "$PID" ]; then',
    '    kill "$PID" >/dev/null 2>&1 || true',
    '    wait "$PID" >/dev/null 2>&1 || true',
    '  fi',
    '  rm -rf "$PROFILE_DIR"',
    '}',
    'trap cleanup EXIT',
    `"$CHROME_PATH" --user-data-dir="$PROFILE_DIR" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 about:blank >> "$LOG_PATH" 2>&1 &`,
    'PID="$!"',
    'READY=0',
    'for _ in $(seq 1 40); do',
    "  if node --input-type=module -e \"const response = await fetch('http://127.0.0.1:9222/json/version'); if (!response.ok) process.exit(1); const payload = await response.json(); if (!payload.webSocketDebuggerUrl) process.exit(1);\" >/dev/null 2>&1; then",
    '    READY=1',
    '    break',
    '  fi',
    '  if ! kill -0 "$PID" >/dev/null 2>&1; then',
    '    break',
    '  fi',
    '  sleep 0.25',
    'done',
    'if [ "$READY" -ne 1 ]; then',
    `  printf '%s\\n' 'Chromium did not expose a DevTools endpoint on 127.0.0.1:9222.' >> "$LOG_PATH"`,
    '  exit 1',
    'fi'
  ].join('\n')
}

export const ensureContainerMcpConfigured = async ({
  agent,
  containerName,
  sessionRoot,
  timeoutMs,
  workdir
}: ContainerExecutionTarget): Promise<void> => {
  const getResult = await runContainerCommand({
    agent,
    containerArgs: [agent, 'mcp', 'get', 'chrome-devtools'],
    containerName,
    onStderr: undefined,
    onStdout: undefined,
    sessionRoot,
    timeoutMs,
    workdir
  })

  const output = `${getResult.stdout}\n${getResult.stderr}`

  if (isChromeDevtoolsMcpConfigured({ output })) {
    return
  }

  if (output.includes('chrome-devtools')) {
    const removeResult = await runContainerCommand({
      agent,
      containerArgs: [agent, 'mcp', 'remove', 'chrome-devtools'],
      containerName,
      onStderr: undefined,
      onStdout: undefined,
      sessionRoot,
      timeoutMs,
      workdir
    })

    if (removeResult.exitCode !== 0) {
      throw new CliError({
        message: [
          `Failed to replace the existing chrome-devtools MCP configuration for ${agent} inside the BugScrub container.`,
          removeResult.stderr.trim() || removeResult.stdout.trim() || 'Unknown MCP reconfiguration failure.'
        ].join('\n'),
        exitCode: 1
      })
    }
  }

  const addResult = await runContainerCommand({
    agent,
    containerArgs:
      agent === 'codex'
        ? [agent, 'mcp', 'add', 'chrome-devtools', '--', CHROME_DEVTOOLS_MCP_COMMAND]
        : [agent, 'mcp', 'add', 'chrome-devtools', '--scope', 'user', '--', CHROME_DEVTOOLS_MCP_COMMAND],
    containerName,
    onStderr: undefined,
    onStdout: undefined,
    sessionRoot,
    timeoutMs,
    workdir
  })

  if (addResult.exitCode !== 0) {
    throw new CliError({
      message: [
        `Failed to configure chrome-devtools MCP for ${agent} inside the BugScrub container.`,
        addResult.stderr.trim() || addResult.stdout.trim() || 'Unknown MCP configuration failure.'
      ].join('\n'),
      exitCode: 1
    })
  }
}

export const preflightChromeDevtoolsBrowser = async ({
  agent,
  containerName,
  logPath,
  sessionRoot,
  timeoutMs,
  workdir
}: ContainerExecutionTarget & {
  logPath: string
}): Promise<void> => {
  const result = await runShellInContainer({
    agent,
    containerName,
    sessionRoot,
    script: buildChromeDevtoolsBrowserPreflightScript({
      logPath
    }),
    timeoutMs: Math.min(timeoutMs, 20_000),
    workdir
  })

  if (result.exitCode !== 0) {
    throw new CliError({
      message: [
        'The BugScrub container could not establish a healthy headless Chromium DevTools session before launching the agent.',
        `Browser preflight log: ${logPath}`,
        result.stderr.trim().length > 0 ? `stderr:\n${result.stderr.trim()}` : 'stderr: (empty)',
        result.stdout.trim().length > 0 ? `stdout:\n${result.stdout.trim()}` : 'stdout: (empty)'
      ].join('\n'),
      exitCode: 1
    })
  }
}

export const resolveBrowserPreflightLogPath = ({
  browserPreflightLogPath,
  cwd
}: {
  browserPreflightLogPath?: string
  cwd: string
}): string => {
  return browserPreflightLogPath ?? join(cwd, '.bugscrub', 'debug', 'chrome-devtools-preflight.log')
}
