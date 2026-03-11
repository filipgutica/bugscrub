import { CliError } from '../../utils/errors.js'
import { runCommand } from './process.js'
import type { AgentName } from './types.js'

const getSetupCommand = ({
  agent
}: {
  agent: AgentName
}): string => {
  return agent === 'codex'
    ? 'codex mcp add chrome-devtools -- npx chrome-devtools-mcp@latest'
    : 'claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest'
}

export const ensureChromeDevtoolsMcpConfigured = async ({
  agent
}: {
  agent: AgentName
}): Promise<void> => {
  const command = await runCommand({
    command: agent,
    args: ['mcp', 'get', 'chrome-devtools'],
    timeoutMs: 3_000
  })
  const output = `${command.stdout}\n${command.stderr}`
  const isConfigured =
    output.includes('chrome-devtools') &&
    !/not found|unknown|No MCP server/i.test(output)

  if (!isConfigured) {
    throw new CliError({
      message: [
        `The \`chrome-devtools\` MCP server is required for live ${agent} runs.`,
        'Configure it first with:',
        getSetupCommand({ agent })
      ].join('\n'),
      exitCode: 1
    })
  }
}
