# BugScrub Codebase Guide

This document is the onboarding guide for people who need to work in the BugScrub codebase.

It is intentionally more detailed than [architecture.md](/Users/filip.gutica@konghq.com/code/bugscrub/docs/architecture.md). The architecture doc explains boundaries and command state machines. This guide explains what the code actually does, which modules own which behavior, and what happens when commands run.

## 1. Mental Model

BugScrub is not "a prompt that tests a site."

The stable product shape is:

```text
repo .bugscrub/ definitions
  -> core loading and resolution
  -> command-specific orchestration
  -> agent/container runtime
  -> normalized report artifacts
```

The most important execution contract is:

```text
RunContext -> AgentAdapter -> AdapterRunOutput -> RunReport
```

Where:

- `RunContext` is BugScrub's fully resolved execution input.
- `AgentAdapter` is the runtime integration for `codex` or `claude`.
- `AdapterRunOutput` is the adapter's structured response plus debug artifacts.
- `RunReport` is the final Markdown/JSON report written back to `.bugscrub/reports/`.

BugScrub owns the semantics. Agents are replaceable runtimes.

## 2. Top-Level Source Map

### `src/index.ts`

Builds the CLI and registers top-level commands. If you want to know which commands exist and how the CLI is assembled, start here.

### `src/commands/`

Thin command entrypoints:

- `init.ts`
- `discover.ts`
- `generate.ts`
- `run.ts`
- `schema.ts`
- `setup.ts`
- `setup-runtime.ts`
- `validate.ts`

These files should stay small. Their job is to parse flags, call domain logic, and keep command-local error messages readable.

### `src/core/`

Loads repo-local `.bugscrub/` files and resolves them into validated in-memory structures.

Important modules:

- `config.ts`: loads `bugscrub.config.yaml`
- `loader.ts`: reads workspace files
- `resolver.ts`: turns YAML files into resolved surfaces/workflows with cross-file references validated
- `paths.ts`: shared path helpers

If you need to understand how YAML becomes executable data, this is the layer to read.

### `src/schemas/`

All Zod-backed schemas and JSON Schema export helpers.

Important files:

- `config.schema.ts`
- `surface.schema.ts`
- `workflow.schema.ts`
- `run-result.schema.ts`

This directory defines the stable contracts for repo files and run outputs.

### `src/init/`

Owns repository bootstrap and authoring-agent handoff generation.

Important modules:

- `detector.ts`: framework/test-runner detection
- `context.ts`: repo context collection
- `handoff.ts`: authoring prompt payloads
- `scaffolder.ts`: writing scaffold files
- `bootstrap.ts`: orchestration glue

This directory exists so `init` and `discover` can evolve without polluting runtime execution logic.

### `src/generate/`

Deterministic workflow draft generation from one source of truth.

Important modules:

- `route.ts`: route-driven generation
- `common.ts`: shared draft helpers
- `writer.ts`: output writing
- `tests.ts`: test-driven source selection helpers
- `diff.ts`: diff-based source selection helpers

`generate` should stay deterministic. It does not invoke agents.

### `src/runner/`

Owns live workflow execution semantics.

Important modules:

- `index.ts`: the top-level `bugscrub run` state machine
- `context.ts`: workflow selection and `RunContext` construction
- `requirements.ts`: validates runtime capability requirements
- `negotiator.ts`: adapter capability negotiation
- `assertions.ts`: assertion coverage validation and repair
- `output-repair.ts`: repair-only retry loops for invalid or incomplete structured output
- `result-mapping.ts`: remaps container-side evidence and transcript paths back to host results
- `diagnostics.ts`: prompt/schema/transcript/report artifact paths and writes
- `local-runtime.ts`: host URL normalization for in-container local app startup
- `prompt/`: prompt construction
- `agent/`: runtime adapters

If the question is "what happens during `bugscrub run`?", this directory is the answer.

### `src/runner/agent/`

Adapter-specific runtime integration.

Important files:

- `types.ts`: adapter contracts
- `codex.ts`: Codex adapter
- `claude.ts`: Claude adapter
- `result.ts`: RunResult parsing and invalid-output error handling
- `repair.ts`: repair-only prompt generation for malformed/incomplete output
- `process.ts`: subprocess execution helpers

### `src/agent-runtime/`

The Docker/container execution boundary.

Important modules:

- `container.ts`: stable facade imported by the rest of the codebase
- `workspace.ts`: disposable workspaces and `.bugscrub/` sync-back
- `auth.ts`: auth discovery, env filtering, and staged agent homes
- `docker.ts`: Docker command construction, one-shot execution, and shared session lifecycle
- `local-runtime.ts`: in-container dev-server startup and readiness checks
- `browser.ts`: `chrome-devtools` MCP migration and Chromium DevTools preflight

### `src/reporter/`

Final report rendering:

- `index.ts`
- `json.ts`
- `markdown.ts`

### `src/utils/`

Small cross-cutting helpers:

- `errors.ts`
- `logger.ts`
- `fs.ts`
- `yaml.ts`
- `date.ts`
- `run-id.ts`

If a utility starts to accumulate business rules, it should usually move back into the owning domain directory.

## 3. Command Walkthroughs

This section explains what actually happens in code when someone runs a command.

### `bugscrub setup-runtime`

Primary files:

- [src/commands/setup-runtime.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/commands/setup-runtime.ts)
- [scripts/build-agent-image.ts](/Users/filip.gutica@konghq.com/code/bugscrub/scripts/build-agent-image.ts)
- [docker/bugscrub-agent.Dockerfile](/Users/filip.gutica@konghq.com/code/bugscrub/docker/bugscrub-agent.Dockerfile)

Flow:

1. Resolve the image tag. Default is `bugscrub-agent:latest`, overridable via `BUGSCRUB_CONTAINER_IMAGE`.
2. Check Docker and Buildx availability.
3. If the image already exists and `--force` is not used, return early.
4. Otherwise build the agent image from `docker/bugscrub-agent.Dockerfile`.

Important detail:

- This command provisions the local runtime image once per machine/tag.
- It does not run a workflow.

### `bugscrub init`

Primary files:

- [src/commands/init.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/commands/init.ts)
- [src/init/bootstrap.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/init/bootstrap.ts)
- [src/init/detector.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/init/detector.ts)
- [src/init/handoff.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/init/handoff.ts)

Flow:

1. Select the workspace package if running from a monorepo root.
2. Detect framework, test runner, routes, and repo context.
3. Create an initial `.bugscrub/` scaffold.
4. Copy the repo into a disposable workspace.
5. Invoke the authoring agent inside Docker.
6. Validate the authored files.
7. If validation fails, feed errors back to the authoring agent and retry.
8. Sync `.bugscrub/**` back to the host repo.

Why this matters:

- `init` already had a repair/retry loop before `run` did.
- That is why `init` is more tolerant of imperfect initial agent output.

### `bugscrub discover`

Primary files:

- [src/commands/discover.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/commands/discover.ts)
- [src/init/handoff.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/init/handoff.ts)

Flow is similar to `init`, but it starts from an existing `.bugscrub/` workspace and asks the authoring agent to fill missing assets rather than bootstrap from scratch.

### `bugscrub generate`

Primary files:

- [src/commands/generate.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/commands/generate.ts)
- [src/generate/route.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/generate/route.ts)
- [src/generate/common.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/generate/common.ts)

Flow:

1. Load current `.bugscrub/` state.
2. Pick one source of truth: route, diff, tests, or existing workflow.
3. Resolve or infer the target surface.
4. Draft workflow YAML.
5. Either print it (`--dry-run`) or write it to `.bugscrub/workflows/`.

Important detail:

- `generate` is deterministic.
- It does not invoke Codex or Claude.

### `bugscrub validate`

Primary files:

- [src/commands/validate.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/commands/validate.ts)
- [src/core/resolver.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/core/resolver.ts)

Flow:

1. Load config, surfaces, workflows, assertions, capabilities, and signals.
2. Validate schemas.
3. Validate cross-file references and semantic rules.
4. Exit with structured validation failures or success.

Important detail:

- `validate` is the semantic gate for repo-local definitions.
- `run` assumes validated inputs and should not duplicate this logic.

### `bugscrub run`

Primary files:

- [src/commands/run.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/commands/run.ts)
- [src/runner/index.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/index.ts)
- [src/agent-runtime/container.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/agent-runtime/container.ts)
- [src/runner/context.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/context.ts)
- [src/runner/output-repair.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/output-repair.ts)
- [src/runner/prompt/builder.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/prompt/builder.ts)
- [src/reporter/index.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/reporter/index.ts)

Detailed flow:

1. Select the target package if invoked from a monorepo root.
2. Load repo-local config and workflow files.
3. Resolve the selected workflow and target surface.
4. Detect and select an adapter (`codex` or `claude`).
5. Negotiate runtime capabilities.
6. Build a `RunContext`.
7. If `--dry-run`, print the resolved plan and stop.
8. Copy the repo into a disposable workspace.
9. Start a shared session container from the BugScrub agent image.
10. If the environment declares `localRuntime`, install/start the app inside that same container and wait for readiness.
11. Write prompt and response-schema artifacts into `.bugscrub/debug/<runId>/`.
12. Invoke the adapter.
13. If the adapter returns malformed structured output, ask it for repair-only output up to the configured cap.
14. If the adapter returns incomplete hard-assertion coverage, ask it for repair-only output up to the configured cap.
15. If hard-assertion coverage is still incomplete after repair attempts, normalize the final report by inserting `not_evaluated` assertion results instead of discarding the run.
16. Sync `.bugscrub/**` back to the host repo.
17. Write Markdown and JSON reports.
18. Stop the session container and clean up the disposable workspace.

This is the most important onboarding sequence in the product.

### `bugscrub schema`

Primary files:

- [src/commands/schema.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/commands/schema.ts)
- [src/schemas/index.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/schemas/index.ts)

Flow:

1. Validate the requested schema name.
2. Print the JSON Schema.

## 4. Detailed `run` Example

This is what happens in code for a command like:

```bash
bugscrub run --workflow rbac_console_exploration
```

### Step 1: CLI entrypoint

[src/commands/run.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/commands/run.ts) parses flags and calls `executeRun(...)`.

### Step 2: Load and resolve repo state

[src/runner/context.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/context.ts) loads config/workflows/surfaces and resolves:

- selected workflow
- selected surface
- identities
- assertions
- capabilities
- artifact paths

At this point, BugScrub has enough information to build a full `RunContext`.

### Step 3: Build the prompt

[src/runner/prompt/sections.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/prompt/sections.ts) creates the sections for:

- target application
- runtime preparation
- authentication
- setup steps
- exploration tasks
- hard assertions
- evidence instructions
- output schema expectations

[src/runner/prompt/builder.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/prompt/builder.ts) assembles those into the final prompt string.

### Step 4: Start the container session

[src/agent-runtime/workspace.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/agent-runtime/workspace.ts) and [src/agent-runtime/docker.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/agent-runtime/docker.ts) do the following:

- creates a disposable workspace copy
- creates a writable agent home
- stages auth into that home if needed
- starts a long-lived session container

All agent commands and browser interaction for this run happen inside that same container.

### Step 5: Prepare local runtime, if configured

If the selected environment declares `localRuntime`, BugScrub runs the install/start commands inside the session container and waits for the configured readiness URL.

This is why `run` logs things like:

```text
Installing app dependencies in-container: pnpm install --frozen-lockfile
Starting app in-container: pnpm dev --host 127.0.0.1 --port 5173
Waiting for local runtime readiness at http://127.0.0.1:5173/...
```

### Step 6: Prepare browser runtime

Before agent execution, BugScrub:

- ensures the `chrome-devtools` MCP server is configured
- migrates stale adapter configs to the image-local `chrome-devtools-mcp` binary
- runs a Chromium DevTools preflight

This is handled by [src/agent-runtime/browser.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/agent-runtime/browser.ts), invoked through the runtime facade in [src/agent-runtime/container.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/agent-runtime/container.ts).

### Step 7: Invoke the adapter

Adapter-specific behavior lives in:

- [src/runner/agent/codex.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/agent/codex.ts)
- [src/runner/agent/claude.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/agent/claude.ts)

The adapter is responsible for:

- launching the agent CLI inside the container
- parsing the raw structured output
- returning `AdapterRunOutput`

### Step 8: Repair malformed output if needed

If the agent returns malformed JSON or schema-invalid output, BugScrub does not immediately discard the run.

Instead it uses the repair-only prompt in [src/runner/agent/repair.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/agent/repair.ts), telling the adapter:

- do not re-run exploration
- do not browse again
- return only corrected final JSON

This makes output repair much cheaper than repeating the workflow.

The retry loop itself lives in [src/runner/output-repair.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/output-repair.ts), while host-path remapping for the final report lives in [src/runner/result-mapping.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/result-mapping.ts).

### Step 9: Repair assertion coverage if needed

Even if the JSON schema is valid, the output can still be semantically incomplete. The most common example is a missing hard assertion result.

BugScrub handles that in two phases:

1. Ask the agent for a repair-only structured output.
2. If the payload is still incomplete after repair attempts, normalize the final report by inserting `not_evaluated` assertion results in [src/runner/assertions.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/assertions.ts).

This avoids losing a real browser run just because the agent forgot one assertion entry.

### Step 10: Write reports and sync back

The final report write happens in:

- [src/reporter/index.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/reporter/index.ts)
- [src/reporter/json.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/reporter/json.ts)
- [src/reporter/markdown.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/reporter/markdown.ts)

The host repo receives only `.bugscrub/**` artifacts:

- prompt artifact
- response schema artifact
- transcript artifact
- screenshots
- network logs
- JSON report
- Markdown report

## 5. Detailed `init` Example

This is what happens in code for a command like:

```bash
bugscrub init
```

1. [src/commands/init.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/commands/init.ts) selects the workspace package.
2. [src/init/detector.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/init/detector.ts) inspects framework and test-runner signals.
3. [src/init/context.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/init/context.ts) gathers repo context.
4. [src/init/scaffolder.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/init/scaffolder.ts) writes the minimal scaffold.
5. [src/init/handoff.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/init/handoff.ts) builds the authoring handoff.
6. [src/agent-runtime/container.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/agent-runtime/container.ts) provisions the disposable workspace and container runtime through the extracted runtime modules.
7. The authoring agent writes `.bugscrub/` files in isolation.
8. Validation runs.
9. If validation fails, `init` loops with the validation feedback until the result is valid or the command fails.
10. The validated `.bugscrub/` tree syncs back to the host repo.

The important difference from `run` is that `init` is creating repo-local assets, not executing a workflow against an already defined surface.

## 6. Where To Look For Common Changes

### "I need to change report contents"

Start with:

- [src/reporter/index.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/reporter/index.ts)
- [src/reporter/json.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/reporter/json.ts)
- [src/reporter/markdown.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/reporter/markdown.ts)

### "I need to change how prompts are written"

Start with:

- [src/runner/prompt/sections.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/prompt/sections.ts)
- [src/runner/prompt/builder.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/prompt/builder.ts)
- [src/init/handoff.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/init/handoff.ts)

### "I need to change Docker/runtime behavior"

Start with:

- [src/agent-runtime/container.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/agent-runtime/container.ts)
- [src/agent-runtime/browser.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/agent-runtime/browser.ts)
- [src/agent-runtime/docker.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/agent-runtime/docker.ts)
- [docker/bugscrub-agent.Dockerfile](/Users/filip.gutica@konghq.com/code/bugscrub/docker/bugscrub-agent.Dockerfile)

### "I need to change command wiring"

Start with:

- [src/index.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/index.ts)
- [src/commands/](/Users/filip.gutica@konghq.com/code/bugscrub/src/commands)

### "I need to change schema behavior"

Start with:

- [src/schemas/](/Users/filip.gutica@konghq.com/code/bugscrub/src/schemas)
- [src/core/resolver.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/core/resolver.ts)

### "I need to change adapter behavior"

Start with:

- [src/runner/agent/types.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/agent/types.ts)
- [src/runner/agent/codex.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/agent/codex.ts)
- [src/runner/agent/claude.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/agent/claude.ts)
- [src/runner/agent/result.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/agent/result.ts)
- [src/runner/agent/repair.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/agent/repair.ts)

## 7. Reading Order For New Contributors

If you are new to the codebase, read in this order:

1. [README.md](/Users/filip.gutica@konghq.com/code/bugscrub/README.md)
2. [docs/intro.md](/Users/filip.gutica@konghq.com/code/bugscrub/docs/intro.md)
3. [docs/architecture.md](/Users/filip.gutica@konghq.com/code/bugscrub/docs/architecture.md)
4. [docs/source-layout.md](/Users/filip.gutica@konghq.com/code/bugscrub/docs/source-layout.md)
5. [docs/codebase-guide.md](/Users/filip.gutica@konghq.com/code/bugscrub/docs/codebase-guide.md)
6. [src/runner/index.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/index.ts)
7. [src/runner/context.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/context.ts)
8. [src/agent-runtime/container.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/agent-runtime/container.ts)
9. [src/agent-runtime/docker.ts](/Users/filip.gutica@konghq.com/code/bugscrub/src/agent-runtime/docker.ts)

If you understand `runner/index.ts`, `runner/context.ts`, and the `agent-runtime/*` split, you understand most of the product runtime.
