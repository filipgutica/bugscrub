# BugScrub — Positioning Doc

## What BugScrub Is

**BugScrub is a schema-driven CLI for running capability-bounded exploratory bug scrub workflows against web applications and APIs.**

It is built for engineering teams that already have solid automated testing, but still rely on **manual bug scrubs / bug bashes** to uncover edge cases, UX gaps, and workflow issues that deterministic tests miss.

BugScrub does **not** replace:

* unit tests
* component tests
* end-to-end regression tests
* synthetic monitoring

It complements them by automating a workflow many teams already perform manually:

* pick a feature
* define what should be explored
* test around the golden path
* capture evidence
* summarize findings
* create tickets or fix issues

In short:

**tests protect known behavior**
**BugScrub helps discover unknown issues**

---

## The Problem

Modern teams often have strong automation but weak exploratory coverage.

Automated tests are good at answering:

* did a change break an expected flow?
* does this component still render correctly?
* does this endpoint still return what we expect?

They are much worse at answering:

* what happens if the user backs up mid-flow?
* what if filters are changed in an unusual order?
* is the UI feedback confusing or inconsistent?
* does the workflow still make sense under realistic variation?

That is why teams still run manual bug scrubs.

These sessions are valuable, but they are also:

* manual
* inconsistent
* difficult to repeat
* expensive in engineering time
* hard to scale into regular practice

Many teams do not have dedicated manual QA, so exploratory testing only happens occasionally and under time pressure.

---

## The Core Idea

BugScrub turns bug scrubs into **repeatable workflows defined in the repository**.

A workflow does not define brittle step-by-step automation.
It defines a **mission** with boundaries:

* target surface
* setup requirements
* exploration tasks
* hard assertions
* evidence rules
* runtime budget

Exploration is **bounded by repo-defined capabilities**, not left to arbitrary AI guessing.

That distinction matters.

BugScrub is not “ask an LLM to poke around the app.”

It is:

**surface + capabilities + workflow + agent runtime**

That gives teams structured exploration without losing control.

---

## How It Works

BugScrub runs inside the repo being tested.

```text
.bugscrub/
  bugscrub.config.yaml
  workflows/
  surfaces/
  reports/
  generated/
```

Workflows reference named surfaces and capabilities defined in the repo.

Example shape:

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
    - capability: manipulate_query_filters
      min: 1
      max: 2

hard_assertions:
  - no_blank_screen
  - no_5xx_responses

evidence:
  screenshots: true
  network_logs: true
```

This is **not open-ended agent behavior**.

It is **capability-bounded exploration around a known surface**.

---

## Product Architecture

BugScrub owns:

* workflow semantics
* schema validation
* capability resolution
* run contracts
* assertion evaluation
* normalized reports

Agents are interchangeable runtimes behind adapters.

The core execution model is:

```text
RunContext -> AgentAdapter -> RunResult
```

That means the durable product value is **not the prompt**.

The durable value is:

* stable contracts
* repo-defined workflows
* capability negotiation
* predictable outputs
* useful reporting

If an external runtime changes, one adapter changes.
Workflows and reports stay stable.

This is a major design principle:

**workflows must never encode agent-specific behavior**

---

## Commands

BugScrub v0 is intentionally a small CLI:

```text
bugscrub init
bugscrub validate
bugscrub generate
bugscrub run
bugscrub schema
```

### `init`

Scans the repo, detects app/test structure, and scaffolds a draft `.bugscrub/` layout.

### `validate`

Validates workflow, surface, capability, and config YAML against the schema.

### `generate`

Creates draft workflow YAMLs from a source of truth: a git diff, existing tests, a route, or an existing workflow.

```bash
bugscrub generate --from-diff                                   # draft workflows for changed surfaces
bugscrub generate --from-tests                                  # draft workflows adjacent to existing test coverage
bugscrub generate --from-route /checkout                        # draft workflow for one surface
bugscrub generate --from-workflow .bugscrub/workflows/x.yaml   # clone and adapt an existing workflow
```

`init` runs once. `generate` runs whenever features, diffs, routes, or tests change.

### `run`

Executes a workflow using an agent adapter after resolving auth and validating required capabilities.

### `schema`

Prints a JSON Schema for a given config type, or writes all schemas to `.bugscrub/generated/schemas/` for editor tooling.

```bash
bugscrub schema workflow    # print JSON Schema for WorkflowConfig
bugscrub schema --write     # write all schemas + inject VS Code YAML associations
```

---

## Who It Is For

BugScrub is for engineering teams that:

* ship web apps or APIs
* already have decent automated coverage
* do not have dedicated manual QA
* run bug scrubs / bug bashes for new features
* want a repeatable, developer-friendly way to automate part of that process

Best-fit teams are likely:

* SaaS product teams
* internal platform teams
* dashboard-heavy applications
* admin tools
* complex workflow UIs

---

## What Makes It Different

### Not a traditional E2E framework

Playwright and Cypress are excellent for deterministic regression coverage.
BugScrub is for bounded exploration around those known flows.

### Not an AI testing SaaS

BugScrub is repo-local, CLI-first, schema-driven, and agent-agnostic.

### Not chaos testing

BugScrub explores within defined boundaries close to realistic user behavior.

### Not promptware

The prompt is an adapter detail.
The product is the execution model, schemas, capability system, and reports.

---

## Why Now

This becomes viable because three things now exist at the same time:

* strong LLM reasoning
* agent runtimes that can interact with code and apps
* browser / API automation surfaces that agents can use effectively

That makes it possible to automate a category of work that previously depended almost entirely on humans.

---

## The Wedge

The clearest way to think about BugScrub is:

**bug bash as code**

Or more precisely:

**capability-bounded exploratory testing as code**

It helps teams move from:

```text
occasional manual bug scrub before release
```

to:

```text
repeatable exploratory runs on a schedule
```

---

## MVP

BugScrub v0 focuses on:

* strict schemas
* repo-local config
* init scaffolding
* workflow validation
* capability negotiation
* agent adapter execution
* markdown + JSON reports

It deliberately avoids:

* a large SaaS platform
* a proprietary agent runtime
* broad autonomous exploration
* over-complicated inference

The goal is a **small, disciplined CLI with clean contracts**.

---

## Long-Term Vision

BugScrub becomes the layer that sits between:

* deterministic regression testing
* human manual exploratory testing

Traditional automation answers:

**did something break?**

BugScrub helps answer:

**what did we not think to test?**

That is the gap many teams still fill manually today.

