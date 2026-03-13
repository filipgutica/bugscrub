# Source Layout

This file explains what belongs in each top-level source directory so changes stay easy to place and review.

## `src/commands`

Thin CLI entrypoints. Parse flags, call the right domain module, and keep command-specific summaries/errors readable. Business logic should usually live elsewhere.

## `src/core`

Repo-local loading and resolution. This is where BugScrub turns YAML files into validated in-memory data structures.

## `src/generate`

Workflow draft generation from a single source of truth. Keep these modules deterministic and lightweight. They should not run agents.

## `src/init`

Bootstrap, repo scanning, authoring handoff generation, and monorepo package targeting. This is where interactive workspace selection and authoring-agent orchestration live.

## `src/agent-runtime`

Container/runtime plumbing shared by `init`, `discover`, and live `run`.

- `container.ts`: stable facade used by the rest of the codebase
- `workspace.ts`: disposable workspace creation and `.bugscrub/` sync-back
- `auth.ts`: auth detection, env filtering, and staged agent homes
- `docker.ts`: Docker command construction and session lifecycle
- `local-runtime.ts`: in-container dev-server startup and readiness checks
- `browser.ts`: chrome-devtools MCP setup and Chromium preflight

## `src/reporter`

Final report rendering. Keep report formatting separate from runtime execution.

## `src/runner`

Execution semantics for `bugscrub run`: capability negotiation, prompt building, diagnostics, adapter invocation, and result normalization.

- `index.ts`: top-level state machine
- `context.ts`: workflow selection and `RunContext` construction
- `output-repair.ts`: structured-output retry loops
- `result-mapping.ts`: host-path remapping and report shaping

## `src/schemas`

Zod-backed contract definitions for repo files and run outputs. Schema changes usually imply docs, validation, and fixture updates.

## `src/utils`

Small cross-cutting helpers only. If a helper starts to accumulate domain rules, move it back into the owning directory instead of turning `utils/` into a grab bag.

## Terminology

- Use `AgentAdapter` for the runtime integration boundary.
- Use "authoring agent" for the `init` and `discover` subprocesses that create repo-local YAML.
- Use "workflow draft" for output from `generate`.
- Use "RunContext" for the fully resolved execution input passed to an adapter.
