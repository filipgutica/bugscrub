<p align="center">
  <img src="./docs/bugscrub_logo.png" width="300" alt="BugScrub logo">
</p>

<h1 align="center">BugScrub</h1>

<p align="center">
Schema-driven exploratory bug scrubbing for web apps and APIs.
</p>

<p align="center">
<code>init</code> · <code>discover</code> · <code>generate</code> · <code>run</code> · <code>validate</code>
</p>

BugScrub is a schema-driven CLI for running capability-bounded exploratory bug scrub workflows against web applications and APIs.

It is built for teams that already have solid automated test coverage, but still rely on manual bug scrubs or bug bashes to find edge cases, workflow issues, and UX gaps that deterministic tests miss.

## What It Does

BugScrub turns exploratory testing into repo-defined workflows.

Instead of encoding brittle step-by-step automation, a workflow defines:

- the target surface
- the capabilities available during exploration
- setup requirements
- hard assertions
- evidence rules
- runtime budget

The core model is:

```text
RunContext -> AgentAdapter -> RunResult
```

BugScrub owns the workflow semantics, schema validation, capability resolution, and reporting. Agent adapters are replaceable runtime integrations, not the product itself.

## Where It Fits

BugScrub complements existing testing rather than replacing it.

- Unit, component, and end-to-end tests protect known behavior.
- BugScrub helps discover unknown issues through bounded exploratory runs.

This is not a traditional E2E framework, not an AI testing SaaS, and not open-ended prompt-driven testing. It is exploratory testing as code, with repo-defined boundaries.

## CLI

```text
bugscrub init
bugscrub setup
bugscrub discover
bugscrub validate
bugscrub generate
bugscrub run
bugscrub schema
```

- `init` bootstraps `.bugscrub/` in a new repo, invokes an authoring agent, and validates authored files before syncing them back.
- `setup` adds a local-dev `bugscrub` shell function to your shell rc file.
- `discover` rescans an already initialized repo, asks the agent to add missing surfaces or workflows, and validates the authored result.
- `validate` checks config, surface, and workflow files against schemas plus cross-file semantic constraints.
- `generate` drafts workflows from interactive source selection, routes, or existing workflows.
- `run` executes a workflow through a compatible agent adapter. Pass `--workflow <path-or-name>` when multiple workflows exist.
- `schema` prints JSON Schemas for inspection and debugging.

## Quickstart

```bash
pnpm install
pnpm build
./dist/bugscrub init
./dist/bugscrub validate
./dist/bugscrub generate
./dist/bugscrub run --workflow .bugscrub/workflows/api-requests.yaml --dry-run
```

In a pnpm monorepo, package-scoped commands support a top-level `--filter` flag:

```bash
./dist/bugscrub --filter apps/web init
./dist/bugscrub --filter workspace-web generate --from-route /settings
./dist/bugscrub --filter apps/admin validate
```

## Local Dev Install

For local development, use the built CLI from your checkout:

- clone this repo
- run `pnpm install`
- run `pnpm build`
- run `./dist/bugscrub setup ~/.zshrc` or `./dist/bugscrub setup ~/.bashrc`
- run `source ~/.zshrc` or `source ~/.bashrc`
- now you can use `bugscrub <command>` anywhere

Example:

```bash
bugscrub validate
bugscrub schema workflow
bugscrub init
```

The `setup` command writes an idempotent shell function block, so rerunning it updates
the existing BugScrub snippet instead of duplicating it.

For installed usage outside local development, use a normal global install such as
`npm install -g bugscrub`.

## Generate Examples

```bash
pnpm dev -- generate
pnpm dev -- generate --from-route /settings --dry-run
pnpm dev -- generate --from-workflow .bugscrub/workflows/api-requests.yaml --dry-run
```

`bugscrub generate` without a source flag opens an interactive picker with:

- current local changes against `HEAD`
- current branch compared to `main`
- current branch compared to another branch
- existing repo tests

Route generation reuses an existing surface when `.bugscrub/surfaces/*/surface.yaml` has an exact route match. Otherwise it writes a draft against an inferred stub surface name and leaves TODO capability markers in the workflow.

## Validation And Run

`bugscrub validate` does more than shape validation. It also checks cross-file references and semantic workflow requirements, such as:

- referenced surfaces, capabilities, assertions, and signals exist
- referenced identities exist in the selected environment
- `workflow.requires` contains supported runtime capability names rather than free-form prose

`bugscrub run` executes one workflow. If the repo contains multiple workflows, pass `--workflow <path-or-name>`.

During `init`, BugScrub seeds `local.baseUrl` from the detected framework defaults, and the authoring agent may refine it for the repo. `run` uses the configured target URL directly, so if the inferred local URL is wrong you can update it in `.bugscrub/bugscrub.config.yaml`.

## Repo Layout

Planned project structure:

```text
.bugscrub/
  bugscrub.config.yaml
  workflows/
  surfaces/
  reports/
```

Workflows reference named surfaces, capabilities, assertions, and signals defined in the repo, which keeps exploration controlled and repeatable.

BugScrub also maintains a global home directory for user-level defaults and CLI-managed schema artifacts:

- Linux: `$XDG_CONFIG_HOME/bugscrub` or `~/.config/bugscrub`
- macOS: `~/Library/Application Support/bugscrub`
- Windows: use WSL and the Linux path conventions above

Global state is machine-local. Repo behavior still lives in `.bugscrub/`.

## Status

This repository is currently in the v0 planning and implementation stage. The current source of truth for the design is:

- [PLAN.md](/Users/filip.gutica@konghq.com/code/bugscrub/PLAN.md)
- [docs/intro.md](/Users/filip.gutica@konghq.com/code/bugscrub/docs/intro.md)

The immediate goal is a small, disciplined CLI with strict schemas, repo-local configuration, agent capability negotiation, and Markdown/JSON reporting.

## Docs

- [Architecture](/Users/filip.gutica@konghq.com/code/bugscrub/docs/architecture.md)
- [AgentAdapter guide](/Users/filip.gutica@konghq.com/code/bugscrub/docs/agent-adapters.md)
- [Source layout](/Users/filip.gutica@konghq.com/code/bugscrub/docs/source-layout.md)
- [Intro](/Users/filip.gutica@konghq.com/code/bugscrub/docs/intro.md)

## Commit Workflow

This repo expects Commitizen-style conventional commits.

- Run `pnpm commit` to open the Commitizen prompt.
- A Husky `commit-msg` hook runs `commitlint`, so non-conforming commit messages are rejected.
