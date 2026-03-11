import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/runner/agent/process.js', () => ({
  isCommandAvailable: vi.fn(),
  runCommand: vi.fn()
}))

import {
  runSetupRuntimeCommand,
  setupRuntimeCommandInternals
} from '../../../src/commands/setup-runtime.js'
import { isCommandAvailable, runCommand } from '../../../src/runner/agent/process.js'
import { CliError } from '../../../src/utils/errors.js'

const mockIsCommandAvailable = vi.mocked(isCommandAvailable)
const mockRunCommand = vi.mocked(runCommand)
const tempDirectories: string[] = []

describe('runSetupRuntimeCommand', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    mockIsCommandAvailable.mockReset()
    mockRunCommand.mockReset()
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('builds the runtime image when it is missing locally', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'bugscrub-runtime-'))
    tempDirectories.push(tempRoot)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await mkdir(join(tempRoot, 'docker'), { recursive: true })
    await writeFile(
      join(tempRoot, 'docker', 'bugscrub-agent.Dockerfile'),
      'FROM node:22-bookworm\n',
      'utf8'
    )

    mockIsCommandAvailable.mockResolvedValue(true)
    mockRunCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: '',
        stdout: '"27.0.0"\n'
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        stderr: 'No such image\n',
        stdout: ''
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: '',
        stdout: 'buildx v0.18.0\n'
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: '',
        stdout: 'built\n'
      })

    await runSetupRuntimeCommand({
      packageRoot: tempRoot
    })

    expect(mockRunCommand).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        args: [
          'buildx',
          'build',
          '--load',
          '--file',
          join(tempRoot, 'docker', 'bugscrub-agent.Dockerfile'),
          '--tag',
          setupRuntimeCommandInternals.DEFAULT_CONTAINER_IMAGE,
          tempRoot
        ],
        command: 'docker'
      })
    )
  })

  it('skips the build when the runtime image already exists', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'bugscrub-runtime-'))
    tempDirectories.push(tempRoot)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await mkdir(join(tempRoot, 'docker'), { recursive: true })
    await writeFile(
      join(tempRoot, 'docker', 'bugscrub-agent.Dockerfile'),
      'FROM node:22-bookworm\n',
      'utf8'
    )

    mockIsCommandAvailable.mockResolvedValue(true)
    mockRunCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: '',
        stdout: '"27.0.0"\n'
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: '',
        stdout: 'already-there\n'
      })

    await runSetupRuntimeCommand({
      packageRoot: tempRoot
    })

    expect(mockRunCommand).toHaveBeenCalledTimes(2)
  })

  it('fails with an actionable error when docker buildx is unavailable', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'bugscrub-runtime-'))
    tempDirectories.push(tempRoot)

    await mkdir(join(tempRoot, 'docker'), { recursive: true })
    await writeFile(
      join(tempRoot, 'docker', 'bugscrub-agent.Dockerfile'),
      'FROM node:22-bookworm\n',
      'utf8'
    )

    mockIsCommandAvailable.mockResolvedValue(true)
    mockRunCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: '',
        stdout: '"27.0.0"\n'
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        stderr: 'No such image\n',
        stdout: ''
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        stderr: 'docker-buildx: no such file or directory\n',
        stdout: ''
      })

    await expect(
      runSetupRuntimeCommand({
        packageRoot: tempRoot
      })
    ).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringContaining('Docker Buildx is required')
    })
  })

  it('fails when docker is unavailable', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'bugscrub-runtime-'))
    tempDirectories.push(tempRoot)

    await mkdir(join(tempRoot, 'docker'), { recursive: true })
    await writeFile(
      join(tempRoot, 'docker', 'bugscrub-agent.Dockerfile'),
      'FROM node:22-bookworm\n',
      'utf8'
    )

    mockIsCommandAvailable.mockResolvedValue(false)

    await expect(
      runSetupRuntimeCommand({
        packageRoot: tempRoot
      })
    ).rejects.toBeInstanceOf(CliError)
  })
})
