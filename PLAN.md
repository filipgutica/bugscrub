# BugScrub v0 — Implementation Plan

## Context

BugScrub is a greenfield CLI tool for running exploratory bug scrub workflows against web applications and APIs. The repo is empty (initialized git, no files).

### Core architectural principle

> **BugScrub owns workflow semantics, capability validation, run contracts, and report structure.
> Agent adapters only translate between BugScrub's normalized contracts and external runtimes.**

The prompt is an adapter implementation detail — not the product. BugScrub's durable value is:
- schema and validation
- capability resolution and negotiation
- normalized `RunContext` (input) and `RunResult` (output)
- reporting

This means agent churn is survivable: Claude CLI changes? Fix one adapter. New agent appears? Add one adapter. Workflows and reports stay stable.

**Workflows must never encode agent-specific behavior.**
```yaml
# Bad — agent-specific
exploration:
  strategy: use-claude-style-iterative-reasoning

# Good — intent and constraints only
exploration:
  tasks:
    - capability: inspect_requests_list
      min: 1
      max: 3
```

---

## Command Lifecycle

> `init` bootstraps BugScrub in a repo and hands repo-specific authoring off to the agent. `generate` creates new workflow drafts over time as features, diffs, routes, and tests evolve.

```
init once        → scaffold minimal .bugscrub/ bootstrap + agent handoff from an existing codebase
generate often   → create or update workflow drafts from a source (diff, tests, route, workflow)
run often        → execute workflows against an agent
validate always  → validate all .bugscrub/ configs (CI gate)
schema           → print JSON schemas for inspection/debugging
```

`init` is a one-time bootstrap that writes config, directories, and an agent handoff. Repo-specific surfaces and workflows are authored after bootstrap. `generate` is the day-2+ workflow authoring tool.

---

## Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.x + Node.js 22 LTS | Native fetch, excellent ESM support |
| Module format | ESM (`"type": "module"`) | Modern, avoids dual-module hazard |
| CLI framework | Commander.js 14.x | Simple, no magic, maps 1:1 to 5 commands |
| Schema | Zod 4.x + zod-to-json-schema 3.x | Runtime validation + TS types + JSON Schema output |
| YAML | yaml 2.x (not js-yaml) | Better types, ESM-native, bidirectional |
| Subprocess | execa 9.x | Streaming stdout/stderr, typed results |
| CLI UX | @inquirer/prompts 8.x + chalk 5.x + ora 9.x | Modern ESM-only, modular |
| Globbing | glob 13.x | For later generation/discovery workflows if needed |
| Tests | Vitest 4.x | Fast, native ESM |
| Dev | tsx 4.x + prettier 3.x + @typescript-eslint 8.x | Standard |

---

## Module Structure

```
src/
  index.ts                    # CLI entry, registers 5 commands
  commands/
    init.ts                   # bugscrub init [--dry-run]
    validate.ts               # bugscrub validate
    generate.ts               # bugscrub generate --from-<source> [--force] [--dry-run]
    run.ts                    # bugscrub run [--dry-run]
    schema.ts                 # bugscrub schema [type]
  schemas/
    config.schema.ts
    workflow.schema.ts        # CRITICAL — all types derived from here
    surface.schema.ts
    capability.schema.ts
    assertion.schema.ts
    signal.schema.ts
    finding.schema.ts         # Finding type — severity, title, reproductionSteps, evidence paths
    agent-output.schema.ts    # structured JSON the agent must emit
    report.schema.ts
    index.ts
  types/
    index.ts                  # z.infer re-exports
  core/
    config.ts                 # load/save bugscrub.config.yaml
    paths.ts                  # resolve repo paths, global BugScrub home, and installed schema artifact paths
    loader.ts                 # load + validate workflow/surface/capability/assertion/signal YAML
    resolver.ts               # resolve surface + capability/assertion/signal refs in a workflow
  init/
    detector.ts               # workspace/framework/test runner detection
    context.ts                # lightweight repo context collection for the agent handoff
    bootstrap.ts              # minimal config seeding (project/baseUrl defaults only)
    scaffolder.ts             # write .bugscrub/ bootstrap files and directories
    summary.ts                # render init summary to stdout + write init-report/agent-handoff
  generate/
    diff.ts                   # --from-diff: parse git diff → touched routes/surfaces
    tests.ts                  # --from-tests: scan test names/routes → capability seeds
    route.ts                  # --from-route: resolve route → surface + draft workflow
    clone.ts                  # --from-workflow: clone + adapt existing workflow YAML
    writer.ts                 # render draft WorkflowConfig → YAML with TODO markers
  runner/
    index.ts                  # full run pipeline orchestration
    negotiator.ts             # capability negotiation: workflow requires vs adapter supports
    agent/
      types.ts                # AgentAdapter interface, AgentCapabilities, RunContext, RunResult
      detector.ts             # detect + select agent adapter
      claude.ts               # Claude Code CLI adapter (JSONL stream → RunResult)
      codex.ts                # Codex CLI adapter (→ RunResult)
    prompt/
      builder.ts              # assemble RunContext → prompt sections (adapter impl detail)
      sections.ts             # individual section renderers (role, target, tasks, etc.)
      serializer.ts           # sections → final Markdown string
    assertions.ts             # validate assertionResults completeness from agent self-report; does not re-evaluate
    diagnostics.ts            # write .bugscrub/debug/ files per run
  reporter/
    markdown.ts
    json.ts
    index.ts
  utils/
    yaml.ts
    fs.ts
    logger.ts
    date.ts
    run-id.ts                 # deterministic run ID generation
schemas-json/                # JSON Schema artifacts generated at build/release time and shipped with BugScrub
sandbox/
  vue-rbac-app/              # local manual-test target: small Vue app with repo-local .bugscrub config
tests/
  unit/
    schemas/
    init/
    runner/
    reporter/
  integration/
    commands/
  fixtures/
    repos/simple-nextjs/
    repos/pnpm-workspace/
    workflows/
    surfaces/
```

---

## Normalized Execution Contracts

These are the two boundaries BugScrub owns. Everything inside is stable; adapters live outside.

### `RunContext` — input to every adapter

```typescript
type RunContext = {
  protocolVersion: '0'                  // bump when contracts change; adapters can detect compatibility
  runId: string
  workflowPath: string                  // absolute path to source workflow YAML; for diagnostics and reports
  workflow: WorkflowConfig
  surface: SurfaceConfig
  capabilities: CapabilityConfig[]       // resolved by name; includes resolved signal refs
  assertions: AssertionConfig[]          // resolved from workflow.hard_assertions
  environment: {
    baseUrl: string
    defaultIdentity: string
    identities: Record<string, AuthConfig>
  }
  evidence: {
    screenshots: boolean
    networkLogs: boolean
  }
  budget: {
    timeoutMs: number
    maxSteps?: number                   // cap agent loop iterations; budget+timeout alone don't prevent loops
    maxBudgetUsd?: number
  }
}
```

### `AuthConfig` — repo-defined identity credential source

```typescript
type AuthConfig =
  | {
      type: 'env'
      usernameEnvVar: string
      passwordEnvVar: string
    }
  | {
      type: 'token-env'
      tokenEnvVar: string
    }
```

For v0, `AuthConfig` is intentionally small. Repo config may point to username/password env vars or a token env var; more auth source types are deferred until a concrete need appears.

### `Finding` — structured bug report

```typescript
type Finding = {
  severity: 'low' | 'medium' | 'high'
  title: string
  description: string
  reproductionSteps: string[]
  evidence?: {
    screenshot?: string                 // file path
    networkLog?: string                 // file path
  }
}
```

### `AssertionResult` — agent self-report for one hard assertion

```typescript
type AssertionResult = {
  assertion: string
  status: 'passed' | 'failed' | 'not_evaluated'
  summary: string
  evidence?: {
    screenshot?: string
    networkLog?: string
  }
}
```

### `RunResult` — output every adapter must return

```typescript
type RunResult = {
  status: 'passed' | 'failed' | 'error'
  startedAt: string                    // ISO 8601
  completedAt: string                  // ISO 8601
  durationMs: number
  findings: Finding[]
  assertionResults: AssertionResult[]
  evidence: {
    screenshots: string[]               // file paths written by agent
    networkLogs: string[]
  }
  transcriptPath?: string              // .bugscrub/debug/{runId}/agent-transcript.jsonl
  raw?: Record<string, unknown>        // adapter-specific raw output, for debug only
}
```

`RunResult` is Zod-validated before the reporter sees it. Invalid adapter output = `status: 'error'`.

For v0, `assertionResults` is agent self-report, not a second BugScrub evaluation pass. BugScrub validates that every `workflow.hard_assertions` entry has a corresponding `AssertionResult`, that names match resolved assertions, and that each result has a valid status.

> **v1 consideration**: add `actions: { capability: string; timestamp: string }[]` to `RunResult` for session replay and debugging. Not required for v0 but the schema slot is reserved.

### `AgentAdapter` interface

```typescript
interface AgentAdapter {
  name: string
  detect(): Promise<boolean>
  getCapabilities(): Promise<AgentCapabilities>
  run(context: RunContext): Promise<RunResult>
}
```

### `AgentCapabilities` — what an adapter can do

```typescript
type AgentCapabilities = {
  browser: {
    navigation: boolean
    domRead: boolean
    networkObserve: boolean
    screenshots: boolean
  }
  api: {
    httpRequests: boolean
  }
  auth: {
    session: boolean
    token: boolean
  }
}
```

### Capability negotiation (before run)

Workflows declare required capabilities:
```yaml
requires:
  - browser.navigation
  - browser.dom.read
  - browser.network.observe
```

Before execution, BugScrub checks: workflow requires X → adapter supports X → fail early with clear message if not. This is `runner/negotiator.ts`.

---

## Key Schemas (Zod — types inferred)

These YAML blocks are illustrative examples meant to show intended shape and relationships.
The canonical source of truth is the Zod implementation in `src/schemas/`; exact required/optional fields may still change during implementation.

### WorkflowConfig
```yaml
name: api-requests-exploration
target:
  surface: api_requests
  env: staging
setup:
  - capability: login
    as: rbac_admin
exploration:
  tasks:
    - capability: inspect_requests_list
      as: rbac_admin
      min: 1
      max: 3
    - capability: verify_export_hidden
      as: readonly_user
      min: 1
      max: 1
hard_assertions:
  - page_not_blank
  - no_5xx_responses
  - api_requests_visible
evidence:
  screenshots: true
  network_logs: true
```

`setup` steps and `exploration.tasks` may specify `as: <identity-name>` to select a repo-defined identity for that step. If omitted, BugScrub uses the environment's `defaultIdentity`.

### SurfaceConfig
```yaml
name: api_requests
routes:
  - /observability/api-requests
elements:
  requests_table:
    test_id: api-requests-table
capabilities: [inspect_requests_list, manipulate_query_filters]
```

### CapabilityConfig
```yaml
name: manipulate_query_filters
description: Change filters on the request list
preconditions: [filters_bar_visible]
guidance:
  - Apply realistic filters
  - Verify results update
success_signals: [results_refresh]
failure_signals: [blank_surface]
```

### AssertionConfig
```yaml
name: api_requests_visible
kind: dom_presence
description: Requests table remains visible on the API requests surface
match:
  test_id: api-requests-table
```

Supported assertion kinds in v0:

- `dom_presence` — `match` must include `test_id`
- `dom_absence` — `match` must include `test_id`
- `text_visible` — `match` must include `text`
- `url_match` — `match` must include `pathname`
- `network_status` — `match` must include `urlContains` and `status`

### SignalConfig
```yaml
name: results_refresh
kind: dom_change
description: Results table updates after filters change
target:
  test_id: api-requests-table
```

Supported signal kinds in v0:

- `dom_change` — `target` must include `test_id`
- `network_request` — `target` must include `urlContains`
- `url_change` — no extra payload required

These kinds define the schema contract only. In v0, agents interpret and self-report against these repo-defined assertions/signals; BugScrub does not independently prove them at runtime.

### BugScrubConfig
```yaml
version: '0'
project: my-app
defaultEnv: staging
envs:
  staging:
    baseUrl: https://staging.example.com
    defaultIdentity: rbac_admin
    identities:
      rbac_admin:
        auth:
          type: env
          usernameEnvVar: BUGSCRUB_ADMIN_USER
          passwordEnvVar: BUGSCRUB_ADMIN_PASS
      readonly_user:
        auth:
          type: env
          usernameEnvVar: BUGSCRUB_VIEWER_USER
          passwordEnvVar: BUGSCRUB_VIEWER_PASS
agent:
  preferred: auto
  timeout: 300
  maxBudgetUsd: 5.00
  maxSteps: 20              # optional; also settable via --max-steps CLI flag (CLI overrides config)
  allowDangerousPermissions: true  # required to invoke claude --dangerously-skip-permissions
```

`BugScrubConfig` is repo-local and lives in `.bugscrub/bugscrub.config.yaml`. For v0, named identities are defined per repo/environment here; the global BugScrub home only stores user-level defaults and logs, not per-repo auth maps.

---

## .bugscrub/ Repo Layout

```
.bugscrub/
  bugscrub.config.yaml
  init-report.md                # written by `bugscrub init`; describes detected context and next steps
  agent-handoff.md              # deterministic prompt/context for the agent to finish authoring repo files
  workflows/
    # intentionally empty after init bootstrap; populated by the agent or generate
  surfaces/
    # intentionally empty after init bootstrap; populated by the agent
  reports/                      # populated on run
```

BugScrub stays generic by interpreting repo-defined `assertion.kind` and `signal.kind` values. The repo owns the named assertions and signals; the CLI owns validation, resolution, and generic evaluators.

## Global BugScrub Home

BugScrub should use the platform-standard user config location rather than a repo-local generated directory:

- Linux: `$XDG_CONFIG_HOME/bugscrub` or `~/.config/bugscrub`
- macOS: `~/Library/Application Support/bugscrub`
- Windows: not supported directly in v0; use WSL and the Linux path conventions above
- Override for development/testing: `BUGSCRUB_HOME`

```text
<bugscrub-home>/
  config.yaml                 # user-level defaults (preferred agent, timeouts, output prefs)
  logs/                       # optional CLI logs / diagnostics
```

This follows the same convention most CLI tools use: repo config stays in the repo, while machine-specific defaults and logs live in the user's OS-native app config directory.

For editor YAML integration, BugScrub ships JSON Schema artifacts with the installed CLI itself. Those files are generated at build/release time and are not copied into the global home.

For local development, the repo may also include a self-contained sandbox app under `sandbox/` with its own `.bugscrub/` config so BugScrub can be exercised manually against a realistic target without depending on an external application.

---

## `generate` Command

`generate` is the day-2+ workflow authoring tool. It creates draft workflow YAMLs from a single source of truth per invocation. `init` runs once; `generate` runs whenever features, diffs, routes, or tests change.

### Usage

```bash
bugscrub generate --from-diff                          # diff HEAD against main (default)
bugscrub generate --from-diff --base staging           # diff HEAD against staging
bugscrub generate --from-tests                         # existing Playwright/Cypress/Vitest tests
bugscrub generate --from-route /checkout               # one UI surface by route
bugscrub generate --from-workflow .bugscrub/workflows/checkout.yaml  # clone + adapt
```

**Rules (v0):**
- Exactly one `--from-*` flag required
- Output defaults to `.bugscrub/workflows/<inferred-name>.yaml`; override with `--output <filename>`
- Never overwrites an existing file without `--force`
- `--dry-run` prints the draft without writing

**v0 scope:** `--from-diff`, `--from-tests`, `--from-route`, `--from-workflow`. All other modes deferred to v1.

### Source modes

| Flag | Input | Output |
|---|---|---|
| `--from-diff` | `git diff HEAD..main` by default; override with `--base <branch>` | Draft workflows for changed surfaces; **killer mode for PR workflows** |
| `--from-tests` | All detected runners (Playwright/Cypress/Vitest); routes deduplicated; runner list noted in YAML header | Exploratory workflow adjacent to existing coverage |
| `--from-route <path>` | Route path string | Workflow centered on one UI surface |
| `--from-workflow <path>` | Existing workflow YAML | Cloned + adapted draft (e.g. checkout → guest-checkout) |

### Output behavior

Generate should:
- Prefer **reusing existing surfaces and capabilities** over inventing new ones
- Use `TODO_define_capability_for_<area>` markers when inference is weak — honest drafts beat silent gaps
- Write a short rationale comment in the workflow YAML header

Example of an honest draft:

```yaml
# Generated from: git diff main..HEAD
# Surfaces touched: checkout, payments
# Note: 'export_flow' capability not found — marked TODO

setup:
  - capability: login

exploration:
  tasks:
    - capability: manipulate_query_filters
      min: 1
      max: 2
    - capability: TODO_define_capability_for_export_flow
      min: 1
      max: 1
```

### `schema` command (clarified)

`schema` prints JSON schemas for inspection/debugging — it is **not** a workflow generator.

```bash
bugscrub schema workflow          # print JSON Schema for WorkflowConfig
```

Runtime validation uses BugScrub's internal Zod schemas directly. For editor tooling, BugScrub ships JSON Schema artifacts with the installed CLI package; `bugscrub init` may optionally write repo-local editor settings that point at those installed schema files.

For v0, `init` intentionally avoids deep route/test/capability inference. The CLI should stay thin and deterministic, while the agent does the repo-specific authoring work once the bootstrap files exist.

---

## Execution Pipeline (`bugscrub run`)

```
generate run ID (utils/run-id.ts)
  → load bugscrub.config.yaml (core/config.ts)
  → load + validate workflow YAML (core/loader.ts)
  → resolve surface + capabilities + assertions + signals → build RunContext (core/resolver.ts)
  → detect + select agent adapter (runner/agent/detector.ts)
  → capability negotiation: workflow.requires vs adapter.getCapabilities() (runner/negotiator.ts)
      → fail early if requirements unmet
  → adapter.run(RunContext) → RunResult
      [inside adapter: build prompt, execute subprocess, parse output, write debug files]
  → validate RunResult against Zod schema
  → validate `assertionResults` coverage/status against resolved hard assertions (runner/assertions.ts)
  → write Markdown + JSON report (reporter/)
```

The prompt is built **inside** the adapter — it is not a BugScrub concern. BugScrub hands the adapter a `RunContext`; the adapter decides how to communicate that to its underlying model.

The `RunResult` Zod schema (`schemas/run-result.schema.ts`) is the output contract. Each adapter is responsible for mapping its raw agent output into a valid `RunResult`. BugScrub validates the result before passing it to reporters or assertion coverage validation — invalid adapter output produces `status: 'error'` with a clear message rather than crashing.

---

## Agent Runtime Detection

Detect all available runtimes first, then select:

```
1. Probe both: `which claude` + `which codex` (parallel)
2. If config.agent.preferred != 'auto' → use that (error if unavailable)
3. Prefer Claude Code CLI if available
4. Fall back to Codex CLI if available
5. Fall back to CLAUDE_TOKEN env var → API-based Claude
6. Fall back to OPENAI_API_KEY env var → API-based Codex
7. Fail with clear instructions listing all options
```

Detection is probe-then-select, not short-circuit. Multiple runtimes may be installed; log which ones were found.

### Claude Code Invocation

> Requires `agent.allowDangerousPermissions: true` in `bugscrub.config.yaml`. If not set, `bugscrub run` fails with instructions to opt in. Only run against non-production or sandboxed environments.

```bash
claude \
  --print \
  --output-format stream-json \
  --dangerously-skip-permissions \
  --max-budget-usd {maxBudgetUsd} \
  "{userPrompt}"
```

### Codex Invocation
```bash
codex exec --full-auto --json "{prompt}"
```

---

## Agent Prompt Structure (adapter implementation detail, inside `runner/agent/claude.ts`)

The prompt is built inside the Claude adapter — not by BugScrub core. It is **prose Markdown** split across:

- `runner/prompt/sections.ts` — pure functions `(ctx: RunContext) => string` per section
- `runner/prompt/builder.ts` — assembles sections in order
- `runner/prompt/serializer.ts` — joins into final string

Sections:
1. **Role framing** — Expert manual tester, not an automated test runner
2. **Target application** — Base URL, surface name/description, routes
3. **Authentication** — Available named identities for the selected environment
4. **Session setup** — Ordered capability list with full guidance, including explicit identity selection via `as:`
5. **Exploration tasks** — Each capability: preconditions, guidance, min/max, referenced success/failure signals, and identity when specified
6. **Hard assertions checklist** — Must verify and self-evaluate each resolved repo-defined assertion; results must appear in `assertionResults` in the final JSON output
7. **Evidence instructions** — Capture screenshots to `.bugscrub/debug/{runId}/screenshots/` and network logs to `.bugscrub/debug/{runId}/network/`; include written file paths in `evidence` fields of `RunResult`
8. **Output format** — Inject `RunResult` as JSON Schema; agent's final message must be a valid `RunResult` JSON object with fully-populated `assertionResults`

Capability, assertion, and signal references use `{surface}.{name}` namespacing (e.g., `api_requests.manipulate_query_filters`, `api_requests.results_refresh`).

BugScrub does not hardcode app-specific meanings like `results_refresh` or `blank_surface`. Those names are repo-local definitions under `.bugscrub/surfaces/<surface>/`, and the CLI only understands their generic `kind` contracts.

For v0, BugScrub supports one active browser session at a time. `prompt/builder.ts` detects identity transitions in the ordered setup+task list and inserts explicit session-switch instructions between steps that change the active identity (logout/login or fresh session).

The Codex adapter may use a different prompt structure — that is its business.

---

## Init Scanning Strategy

### Detection (detector.ts — filesystem only, no execution)
- pnpm workspace: `pnpm-workspace.yaml` exists → prompt for package selection
- Framework: check for `next.config.*`, `nuxt.config.*`, `vite.config.*` + deps in package.json
- Test runners: `vitest.config.*`, `jest.config.*`, `playwright.config.*`, `cypress.config.*`

### Scanning (scanner.ts — regex only, no AST)
- Routes: Next.js `app/**/page.tsx`, Pages `pages/**/*.tsx`, React Router `path=` patterns
- Test names: Playwright `test.describe`/`test(` names, `cy.visit()` URLs
- Elements: `data-testid="..."` values across all TSX/JSX/Vue files (only `data-testid`; `data-cy`, `data-pw` not included in v0)
- API: OpenAPI specs, `*api*` / `*service*` filenames

### Inference (inferrer.ts — v0 scope: routes + tests only)
- Group routes by top-level segment → one `SurfaceConfig` per group
- Test describe/it names → capability drafts per surface (e.g., `"should filter by status"` → `filter_by_status`)
- Always generate: `login` using the environment's default identity + `open_{surface}_surface` setup caps
- RBAC/multi-identity workflow inference deferred unless tests clearly name identities or roles
- **OpenAPI inference deferred to v1** — too much heuristic complexity for v0

---

## Reporting

Files: `.bugscrub/reports/{YYYY-MM-DD}-{runId}-{workflow-name}.{md,json}`

Reports include `runId` for traceability. Debug artifacts (prompt, transcript) are at `.bugscrub/debug/{runId}/`.

Markdown report sections:
- Status summary (runId, passed/failed, agent, duration)
- Assertion results checklist
- Findings (severity, description, steps to reproduce, evidence paths)
- Evidence summary
- Collapsible raw agent transcript

`.bugscrub/` layout including debug:
```
.bugscrub/
  debug/
    {runId}/
      prompt.md               # exact prompt sent to agent
      agent-transcript.jsonl  # raw JSONL stream from agent
      screenshots/            # evidence written by agent during run
      network/                # network log (.har) evidence written by agent
```

---

## Dependency Version Notes

> Verify these versions are current before `pnpm install` — the plan was written ahead of implementation:
> - `glob: "^13.0.6"` — confirm v13 exists on npm (stable may be v11.x)
> - `which: "^6.0.1"` — confirm v6 exists on npm (stable may be v4.x)
> - `zod: "^4.3.6"` — Zod 4 is a major release; confirm `zod-to-json-schema` v3 compatibility with Zod 4 before using

---

## pnpm package.json

```json
{
  "name": "bugscrub",
  "version": "0.1.0",
  "type": "module",
  "bin": { "bugscrub": "./dist/index.js" },
  "dependencies": {
    "commander": "^14.0.3",
    "zod": "^4.3.6",
    "zod-to-json-schema": "^3.25.1",
    "yaml": "^2.8.2",
    "execa": "^9.6.1",
    "glob": "^13.0.6",
    "chalk": "^5.6.2",
    "ora": "^9.3.0",
    "@inquirer/prompts": "^8.3.0",
    "which": "^6.0.1"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "tsx": "^4.21.0",
    "vitest": "^4.0.18",
    "@types/node": "^22.0.0"
  },
  "engines": { "node": ">=22.0.0" }
}
```

---

## Phased Implementation

### Phase 0 — Bootstrap (Day 1)
- `package.json`, `tsconfig.json`, `.gitignore`, vitest config
- `src/index.ts` — Commander skeleton, 5 stub commands
- `src/utils/logger.ts`, `yaml.ts`, `fs.ts`, `date.ts`
- `src/core/paths.ts` — resolve repo paths + platform-native global BugScrub home (`BUGSCRUB_HOME` override) + installed schema artifact paths
- **Milestone**: `pnpm install && pnpm build && bugscrub --help` works

### Phase 1 — Schema Layer (Days 2-3)
- All core Zod schemas in `src/schemas/`, including repo-defined assertion/signal schemas
- `src/core/config.ts`, `core/loader.ts`, `core/resolver.ts` (moved from Phase 3 — required for `validate` ref resolution)
- generate JSON Schema artifacts at build time into `schemas-json/` and include them in the published package
- `src/commands/schema.ts` (fully working — `bugscrub schema <type>` prints JSON Schema; valid types in Phase 1: `workflow`, `surface`, `capability`, `assertion`, `signal`, `finding`, `config`)
- `src/commands/validate.ts` (fully working — validates schema **and** resolves all cross-file refs; broken refs produce actionable errors; exits 1 on failure, 2 on usage error)
- Unit tests for all schemas with valid + invalid fixtures
- **Milestone**: `bugscrub validate` and `bugscrub schema workflow` work; broken capability/assertion refs caught at validate time; CI gate is meaningful; packaged schema artifacts are available for editor integration

### Phase 2 — Init Command (Days 4-7)
- `src/init/detector.ts`, `context.ts`, `bootstrap.ts`, `scaffolder.ts`, `summary.ts`
- `src/commands/init.ts` (bootstrap + interactive package selection)
  - Errors if `.bugscrub/` already exists; pass `--force` to overwrite
  - Detects only lightweight repo context (workspace, framework, test runner, representative files)
  - Seeds a minimal valid `.bugscrub/bugscrub.config.yaml`
  - Leaves `.bugscrub/workflows/` and `.bugscrub/surfaces/` empty for the agent to author
  - pnpm workspace → prompt user to select a package before bootstrapping
  - Optional `--editor vscode` writes `.vscode/settings.json` YAML associations pointing at the installed BugScrub schema artifact paths
  - Writes `.bugscrub/init-report.md`, `.bugscrub/agent-handoff.md`, and prints summary to stdout on completion
- Fixture repos in `tests/fixtures/repos/`
- Integration test: init against simple-nextjs fixture, assert bootstrap files and empty authored directories
- Manual smoke target: `sandbox/vue-rbac-app`
- **Milestone**: `bugscrub init` produces a valid minimal bootstrap and hands repo-specific authoring to the agent

### Phase 3 — Run Command (Days 8-12)
- `src/runner/agent/types.ts` — `AgentAdapter`, `AgentCapabilities`, `RunContext`, `RunResult` — **implement first**
- `src/schemas/run-result.schema.ts` — Zod schema for `RunResult`
- extend `bugscrub schema <type>` to support `run-result`
- `src/runner/negotiator.ts` — capability negotiation
- `src/runner/agent/detector.ts`, `claude.ts`, `codex.ts`
- `src/runner/prompt/` (builder, sections, serializer — inside Claude adapter)
- `src/runner/assertions.ts`, `diagnostics.ts`, `index.ts` — validate completeness of `assertionResults` from agent's self-reported `RunResult`; does not re-evaluate assertions programmatically
- `src/reporter/` (markdown, json, index)
- `src/utils/run-id.ts`
- `src/commands/run.ts` (fully working; `--dry-run` loads + resolves workflow, prints RunContext summary and prompt preview, exits without invoking agent or writing any files; `--max-steps <n>` overrides `agent.maxSteps` from config)
- Unit tests: `AgentAdapter` mock → `RunResult` validation, negotiator, assertions, reporter
- Integration test: `run --dry-run` validates the full load → resolve → negotiate → prompt-build pipeline without invoking any agent
- **PRIMARY MILESTONE**: `bugscrub run` executes a real Claude Code session, adapter returns valid `RunResult`, report produced — everything else is secondary

### Phase 4 — Generate + Polish (Days 13-15)
- `src/commands/generate.ts` — workflow draft generation from `--from-diff`, `--from-tests`, `--from-route`, `--from-workflow`
- `src/generate/` — source readers (diff parser, test scanner, route resolver, workflow cloner) + draft writer
- `README.md`
- Unit tests: each `--from-*` mode with fixture inputs → assert draft YAML shape
- Snapshot tests for scaffolder output
- **Milestone**: Full v0 feature set; `bugscrub generate --from-diff` produces a useful draft workflow; publish as `bugscrub@0.1.0`

---

## Critical Files (Highest Leverage)

1. `src/runner/agent/types.ts` — `AgentAdapter`, `AgentCapabilities`, `RunContext`, `RunResult` interfaces; the contract everything else depends on — implement first in Phase 3
2. `src/schemas/workflow.schema.ts` — Workflow refs must line up with repo-local capability/assertion names; implement first in Phase 1
3. `src/schemas/assertion.schema.ts` — Defines generic assertion kinds while keeping concrete assertion instances repo-local
4. `src/runner/negotiator.ts` — Capability negotiation; fail-fast before spending agent budget
5. `src/runner/agent/claude.ts` — Claude adapter: prompt construction + JSONL stream → `RunResult`; most complex adapter implementation
6. `src/core/paths.ts` — Defines the repo/global boundary and resolves installed schema artifact paths for editor integration; get this wrong and config ergonomics degrade everywhere
7. `src/init/context.ts` — keep this shallow; avoid rebuilding app-specific understanding inside the CLI

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Validation or run failure (schema invalid, ref not found, assertion failed, run errored) |
| `2` | Usage error (missing required arg, unknown flag, unrecognized schema type) |

All error messages go to `stderr` in human-readable format. No structured JSON error output in v0.

---

## Verification

1. `pnpm build` — TypeScript compiles with zero errors
2. `pnpm test` — All unit tests pass
3. `pnpm test:integration` — All integration tests pass (no external services required)
4. `bugscrub --help` — All 5 commands listed
5. `bugscrub schema workflow` — Valid JSON Schema output
6. Published/build artifacts include packaged JSON Schema files under `schemas-json/`
7. `bugscrub validate` — Validates fixture workflows
8. `bugscrub init` in a Next.js repo — Produces minimal `.bugscrub/` bootstrap plus agent handoff
9. `bugscrub init --editor vscode` — Writes working YAML schema associations to `.vscode/settings.json`
10. `bugscrub generate --from-route /checkout --dry-run` — Prints draft workflow YAML without writing
11. `bugscrub generate --from-diff` — Produces a draft workflow for changed surfaces (manual test in real repo)
12. `bugscrub run --dry-run --workflow workflows/test.yaml` — Prints RunContext summary and prompt preview; no agent invoked, no files written
13. `bugscrub run --workflow workflows/api-requests.yaml` — Real Claude Code session completes (manual test)
14. From `sandbox/vue-rbac-app`, `node ../../dist/index.js validate` — Validates a realistic local sandbox repo
