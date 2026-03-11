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

## Planned CLI

```text
bugscrub init
bugscrub discover
bugscrub validate
bugscrub generate
bugscrub run
bugscrub schema
```

- `init` bootstraps `.bugscrub/` in a new repo and immediately invokes an authoring agent.
- `discover` rescans an already initialized repo and asks the agent to add missing surfaces or workflows.
- `validate` checks config and workflow files against schemas.
- `generate` drafts workflows from interactive source selection, routes, or existing workflows.
- `run` executes a workflow through a compatible agent adapter.
- `schema` prints JSON Schemas for inspection and debugging.

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

## Commit Workflow

This repo expects Commitizen-style conventional commits.

- Run `pnpm commit` to open the Commitizen prompt.
- A Husky `commit-msg` hook runs `commitlint`, so non-conforming commit messages are rejected.
