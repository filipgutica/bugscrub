# BugScrub

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
bugscrub validate
bugscrub generate
bugscrub run
bugscrub schema
```

- `init` scaffolds `.bugscrub/` from an existing codebase.
- `validate` checks config and workflow files against schemas.
- `generate` drafts workflows from diffs, tests, routes, or existing workflows.
- `run` executes a workflow through a compatible agent adapter.
- `schema` prints or exports JSON Schemas for editor tooling and validation.

## Repo Layout

Planned project structure:

```text
.bugscrub/
  bugscrub.config.yaml
  workflows/
  surfaces/
  reports/
  generated/
```

Workflows reference named surfaces and capabilities defined in the repo, which keeps exploration controlled and repeatable.

## Status

This repository is currently in the v0 planning and implementation stage. The current source of truth for the design is:

- [PLAN.md](/Users/filip.gutica@konghq.com/code/bugscrub/PLAN.md)
- [docs/intro.md](/Users/filip.gutica@konghq.com/code/bugscrub/docs/intro.md)

The immediate goal is a small, disciplined CLI with strict schemas, repo-local configuration, agent capability negotiation, and Markdown/JSON reporting.

## Commit Workflow

This repo expects Commitizen-style conventional commits.

- Run `pnpm commit` to open the Commitizen prompt.
- A Husky `commit-msg` hook runs `commitlint`, so non-conforming commit messages are rejected.
