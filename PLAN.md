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

> `init` bootstraps BugScrub in a repo. `generate` creates new workflow drafts over time as features, diffs, routes, and tests evolve.

```
init once        → scaffold .bugscrub/ from an existing codebase
generate often   → create or update workflow drafts from a source (diff, tests, route, workflow)
run often        → execute workflows against an agent
validate always  → validate all .bugscrub/ configs (CI gate)
schema           → print or export JSON schemas (editor tooling)
```

`init` is a one-time bootstrap. `generate` is the day-2+ workflow authoring tool.

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
| Globbing | glob 13.x | For init scanning |
| Tests | Vitest 4.x | Fast, native ESM |
| Dev | tsx 4.x + prettier 3.x + @typescript-eslint 8.x | Standard |

---

## Module Structure

```
src/
  index.ts                    # CLI entry, registers 5 commands
  commands/
    init.ts                   # bugscrub init [--dry-run]
    validate.ts               # bugscrub validate [--dry-run]
    generate.ts               # bugscrub generate --from-<source> [--force] [--dry-run]
    run.ts                    # bugscrub run [--dry-run]
    schema.ts                 # bugscrub schema [--write]
  schemas/
    config.schema.ts
    workflow.schema.ts        # CRITICAL — all types derived from here
    surface.schema.ts
    capability.schema.ts
    finding.schema.ts         # Finding type — severity, title, reproductionSteps, evidence paths
    agent-output.schema.ts    # structured JSON the agent must emit
    report.schema.ts
    index.ts
  types/
    index.ts                  # z.infer re-exports
  core/
    config.ts                 # load/save bugscrub.config.yaml
    loader.ts                 # load + validate workflow/surface/capability YAML
    resolver.ts               # resolve surface + capability refs in a workflow
  init/
    detector.ts               # workspace/framework/test runner detection
    scanner.ts                # glob source files, extract routes/elements/tests
    inferrer.ts               # scan results → scaffold objects (routes + tests only in v0)
    scaffolder.ts             # write .bugscrub/ directory tree
    summary.ts                # generate init-summary.md
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
    assertions.ts             # evaluate hard_assertions against RunResult
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
  capabilities: CapabilityConfig[]       // resolved by name
  environment: {
    baseUrl: string
    auth: AuthConfig
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

### WorkflowConfig
```yaml
name: api-requests-exploration
target:
  surface: api_requests
  env: staging
setup:
  - capability: login_as_default_user
exploration:
  tasks:
    - capability: inspect_requests_list
      min: 1
      max: 3
hard_assertions:
  - no_blank_screen
  - no_5xx_responses
  - surface_visible: api_requests
evidence:
  screenshots: true
  network_logs: true
```

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

### BugScrubConfig
```yaml
version: '0'
project: my-app
defaultEnv: staging
envs:
  staging:
    baseUrl: https://staging.example.com
    auth:
      type: env
      envVar: BUGSCRUB_AUTH_TOKEN
agent:
  preferred: auto
  timeout: 300
  maxBudgetUsd: 5.00
```

---

## .bugscrub/ Output Structure

```
.bugscrub/
  bugscrub.config.yaml
  workflows/
    api-requests-exploration.yaml
  surfaces/
    api_requests/
      surface.yaml
      capabilities.yaml         # all caps for this surface in one file
  reports/                      # populated on run
  generated/
    init-summary.md
    schemas/
      workflow.schema.json      # for editor YAML validation
      surface.schema.json
      capability.schema.json
      config.schema.json
```

---

## `generate` Command

`generate` is the day-2+ workflow authoring tool. It creates draft workflow YAMLs from a single source of truth per invocation. `init` runs once; `generate` runs whenever features, diffs, routes, or tests change.

### Usage

```bash
bugscrub generate --from-diff                          # current git diff or branch diff
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
| `--from-diff` | `git diff` / branch / PR text | Draft workflows for changed surfaces; **killer mode for PR workflows** |
| `--from-tests` | Playwright/Cypress describe+test names, `cy.visit()` URLs | Exploratory workflow adjacent to existing coverage |
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
  - capability: login_as_default_user

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

`schema` prints or exports JSON schemas — it is **not** a workflow generator.

```bash
bugscrub schema workflow          # print JSON Schema for WorkflowConfig
bugscrub schema --write           # write all schemas to .bugscrub/generated/schemas/
```

Schema export (`--write`) also injects YAML schema associations into `.vscode/settings.json` for editor validation.

---

## Execution Pipeline (`bugscrub run`)

```
generate run ID (utils/run-id.ts)
  → load bugscrub.config.yaml (core/config.ts)
  → load + validate workflow YAML (core/loader.ts)
  → resolve surface + capabilities → build RunContext (core/resolver.ts)
  → detect + select agent adapter (runner/agent/detector.ts)
  → capability negotiation: workflow.requires vs adapter.getCapabilities() (runner/negotiator.ts)
      → fail early if requirements unmet
  → adapter.run(RunContext) → RunResult
      [inside adapter: build prompt, execute subprocess, parse output, write debug files]
  → validate RunResult against Zod schema
  → evaluate hard assertions against RunResult (runner/assertions.ts)
  → write Markdown + JSON report (reporter/)
```

The prompt is built **inside** the adapter — it is not a BugScrub concern. BugScrub hands the adapter a `RunContext`; the adapter decides how to communicate that to its underlying model.

The `RunResult` Zod schema (`schemas/run-result.schema.ts`) is the output contract. Each adapter is responsible for mapping its raw agent output into a valid `RunResult`. BugScrub validates the result before passing it to reporters or assertion evaluators — invalid adapter output produces `status: 'error'` with a clear message rather than crashing.

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
3. **Authentication** — How to authenticate
4. **Session setup** — Ordered capability list with full guidance
5. **Exploration tasks** — Each capability: preconditions, guidance, min/max, success/failure signals
6. **Hard assertions checklist** — Must verify and report each one
7. **Evidence instructions** — When/where to capture screenshots; write to paths and report back
8. **Output format** — Inject `RunResult` as JSON Schema; agent's final message must match

Capability references use `{surface}.{capability}` namespacing (e.g., `api_requests.manipulate_query_filters`).

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
- Elements: `data-testid="..."` values across all TSX/JSX/Vue files
- API: OpenAPI specs, `*api*` / `*service*` filenames

### Inference (inferrer.ts — v0 scope: routes + tests only)
- Group routes by top-level segment → one `SurfaceConfig` per group
- Test describe/it names → capability drafts per surface (e.g., `"should filter by status"` → `filter_by_status`)
- Always generate: `login_as_default_user` + `open_{surface}_surface` setup caps
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
```

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
- **Milestone**: `pnpm install && pnpm build && bugscrub --help` works

### Phase 1 — Schema Layer (Days 2-3)
- All 5 Zod schemas in `src/schemas/`
- `src/core/config.ts`, `core/loader.ts`
- `src/commands/schema.ts` (fully working — `bugscrub schema <type>` prints JSON Schema; `--write` writes all schemas to `.bugscrub/generated/schemas/` + injects VS Code YAML associations)
- `src/commands/validate.ts` (fully working — validates all `.bugscrub/` YAMLs)
- Unit tests for all schemas with valid + invalid fixtures
- **Milestone**: `bugscrub validate`, `bugscrub schema workflow`, and `bugscrub schema --write` all working; CI can validate schemas; editors get YAML autocompletion

### Phase 2 — Init Command (Days 4-7)
- `src/init/detector.ts`, `scanner.ts`, `inferrer.ts`, `scaffolder.ts`, `summary.ts`
- `src/commands/init.ts` (fully working pipeline with interactive prompts)
- Fixture repos in `tests/fixtures/repos/`
- Integration test: init against simple-nextjs fixture, assert file tree
- **Milestone**: `bugscrub init` generates useful scaffold in a real repo

### Phase 3 — Run Command (Days 8-12)
- `src/runner/agent/types.ts` — `AgentAdapter`, `AgentCapabilities`, `RunContext`, `RunResult` — **implement first**
- `src/schemas/run-result.schema.ts` — Zod schema for `RunResult`
- `src/runner/negotiator.ts` — capability negotiation
- `src/runner/agent/detector.ts`, `claude.ts`, `codex.ts`
- `src/runner/prompt/` (builder, sections, serializer — inside Claude adapter)
- `src/runner/assertions.ts`, `diagnostics.ts`, `index.ts`
- `src/core/resolver.ts`
- `src/reporter/` (markdown, json, index)
- `src/utils/run-id.ts`
- `src/commands/run.ts` (fully working, `--dry-run` flag for CI)
- Unit tests: `AgentAdapter` mock → `RunResult` validation, negotiator, assertions, reporter
- Integration test: `run --dry-run` with a mock adapter that returns a valid fixture `RunResult`
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
2. `src/schemas/workflow.schema.ts` — All types derived here; implement first in Phase 1
3. `src/schemas/finding.schema.ts` — `Finding` type; shared by adapter output, assertions, and reporters
4. `src/runner/negotiator.ts` — Capability negotiation; fail-fast before spending agent budget
5. `src/runner/agent/claude.ts` — Claude adapter: prompt construction + JSONL stream → `RunResult`; most complex adapter implementation
6. `src/core/loader.ts` — Called by every command; error formatting determines DX quality
7. `src/init/inferrer.ts` — Most logic-dense init module; inference quality determines scaffold usefulness

---

## Verification

1. `pnpm build` — TypeScript compiles with zero errors
2. `pnpm test` — All unit tests pass
3. `pnpm test:integration` — All integration tests pass (no external services required)
4. `bugscrub --help` — All 5 commands listed
5. `bugscrub schema workflow` — Valid JSON Schema output
6. `bugscrub schema --write` — Writes JSON schemas to `.bugscrub/generated/schemas/`, injects VS Code settings
7. `bugscrub validate` — Validates fixture workflows
8. `bugscrub init` in a Next.js repo — Produces correct `.bugscrub/` structure
9. `bugscrub generate --from-route /checkout --dry-run` — Prints draft workflow YAML without writing
10. `bugscrub generate --from-diff` — Produces a draft workflow for changed surfaces (manual test in real repo)
11. `bugscrub run --dry-run --workflow workflows/test.yaml` — Produces report files
12. `bugscrub run --workflow workflows/api-requests.yaml` — Real Claude Code session completes (manual test)
