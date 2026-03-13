# BugScrub Architecture

BugScrub keeps repo-defined exploratory intent separate from agent-specific runtime details.

For a more detailed onboarding walkthrough of modules, command execution, and example code paths, see [codebase-guide.md](/Users/filip.gutica@konghq.com/code/bugscrub/docs/codebase-guide.md).

## Command State Machines

Each CLI command is an independent entrypoint. The diagram below groups them side by side, but there are no command-to-command transitions.

```mermaid
flowchart TB
  subgraph Setup["setup"]
    setupA["start"] --> setupB["resolve installed package root"]
    setupB --> setupC["verify dist/bugscrub exists"]
    setupC --> setupD["replace or append shell rc block"]
    setupD --> setupE["shell rc points bugscrub to dist/bugscrub"]
  end

  subgraph SetupRuntime["setup-runtime"]
    runtimeA["start"] --> runtimeB["verify Dockerfile exists"]
    runtimeB --> runtimeC["check docker CLI + daemon"]
    runtimeC --> runtimeD{"image already exists and not --force?"}
    runtimeD -- "yes" --> runtimeE["return existing runtime image"]
    runtimeD -- "no" --> runtimeF["verify docker buildx"]
    runtimeF --> runtimeG["build BugScrub agent image"]
    runtimeG --> runtimeH["runtime image ready"]
  end

  subgraph Init["init"]
    initA["start"] --> initB["select target package"]
    initB --> initC{"existing .bugscrub/?"}
    initC -- "yes" --> initD["fail: use discover instead"]
    initC -- "no" --> initE["detect project + collect repo context"]
    initE --> initF["build config, handoff, and scaffold plan"]
    initF --> initG["write minimal .bugscrub scaffold"]
    initG --> initH{"--dry-run?"}
    initH -- "yes" --> initI["print planned scaffold"]
    initH -- "no" --> initJ["copy repo into disposable workspace"]
    initJ --> initK["authoring agent runs inside Docker"]
    initK --> initL["validate authored files"]
    initL --> initM{"valid?"}
    initM -- "no" --> initN["feed validation errors back to authoring agent"]
    initN --> initK
    initM -- "yes" --> initO["sync validated .bugscrub back to repo"]
  end

  subgraph Discover["discover"]
    discoverA["start"] --> discoverB["select target package"]
    discoverB --> discoverC{"missing .bugscrub/?"}
    discoverC -- "yes" --> discoverD["fail: run init first"]
    discoverC -- "no" --> discoverE["load config + existing workspace files"]
    discoverE --> discoverF["detect project + collect repo context"]
    discoverF --> discoverG["build discover handoff for missing assets"]
    discoverG --> discoverH{"--dry-run?"}
    discoverH -- "yes" --> discoverI["print authoring intent"]
    discoverH -- "no" --> discoverJ["write discover report + handoff"]
    discoverJ --> discoverK["copy repo into disposable workspace"]
    discoverK --> discoverL["author missing surfaces/workflows in Docker"]
    discoverL --> discoverM["validate authored files"]
    discoverM --> discoverN["sync validated .bugscrub back to repo"]
  end

  subgraph Generate["generate"]
    generateA["start"] --> generateB["select target package"]
    generateB --> generateC["load config + workspace files"]
    generateC --> generateD["resolve one source of truth"]
    generateD --> generateE["draft workflow YAML"]
    generateE --> generateF{"--dry-run?"}
    generateF -- "yes" --> generateG["print rendered draft"]
    generateF -- "no" --> generateH["write draft workflow file(s)"]
  end

  subgraph Validate["validate"]
    validateA["start"] --> validateB["select target package"]
    validateB --> validateC["load config + workspace files"]
    validateC --> validateD["validate schemas and cross-file semantics"]
    validateD --> validateE{"issues found?"}
    validateE -- "yes" --> validateF["exit with validation errors"]
    validateE -- "no" --> validateG["report validation passed"]
  end

  subgraph Run["run"]
    runA["start"] --> runB["select target package"]
    runB --> runC["load config + workflow + surfaces"]
    runC --> runD["resolve refs + validate run requirements"]
    runD --> runE["negotiate adapter capabilities"]
    runE --> runF{"--dry-run?"}
    runF -- "yes" --> runG["print resolved run plan"]
    runF -- "no" --> runH["copy repo into disposable workspace"]
    runH --> runI["start a shared session container"]
    runI --> runJ{"configured localRuntime?"}
    runJ -- "yes" --> runK["install/start app and wait for readiness in-container"]
    runJ -- "no" --> runL["build prompt once"]
    runK --> runL["build prompt once"]
    runL --> runM["agent and browser run in the same container"]
    runM --> runN["sync .bugscrub artifacts + reports back to host"]
  end

  subgraph Schema["schema"]
    schemaA["start"] --> schemaB["validate requested schema type"]
    schemaB --> schemaC["print JSON Schema"]
  end
```

## Core Boundaries

- Repo state lives under `.bugscrub/`. That is the product surface.
- Agent-invoking commands do not mutate the host repo directly. They operate on a disposable workspace copy inside Docker and only sync `.bugscrub/**` back to the host.
- The Docker runtime mounts the currently running BugScrub package installation into the container and executes that installation's `dist/bugscrub`, so local checkouts and global installs share the same execution path.
- `init`, `discover`, and live `run` all share the same container/runtime substrate even though they use it for different purposes.
- `init` and `discover` are authoring/bootstrap flows. They should not own workflow execution semantics.
- `init` and `discover` validate authored files before syncing them back to the repo, and `init` can retry authoring with validation feedback when the isolated result is invalid.
- `generate` creates deterministic draft YAML from local evidence like routes, tests, diffs, or an existing workflow.
- `run` is the only place that resolves a workflow into a full `RunContext` and invokes an `AgentAdapter`.
- `init` seeds `local.baseUrl` from framework defaults so each repo starts with an inferred local target that can be refined in config.
- `run` uses the configured target URL directly rather than trying to outsmart the local dev environment at the CLI layer.
- When an environment declares `localRuntime`, `run` owns local app startup inside the shared session container and waits for a configured readiness URL before exploration begins.
- `run` can ask the adapter for repair-only structured output retries when the final JSON payload is malformed or missing hard-assertion coverage. Those retries repair the output rather than rerunning the workflow.
- `validate` is the semantic gate for repo-local definitions. It enforces both file-shape/schema correctness and cross-file constraints such as valid workflow requirements.
- Agent adapters are replaceable runtimes. They receive a prepared `RunContext` and return an `AdapterRunOutput`.
- Docker is the required runtime boundary for agent-backed commands in v1.
- Docker Buildx is part of that runtime prerequisite because BugScrub builds its local agent image through `docker buildx build --load`.
- Container auth is agent-specific. BugScrub forwards env-based auth first and falls back to copying the agent CLI login/config into a writable disposable container home only when env auth is absent.

## Runtime Internals

The runtime layer is intentionally split by responsibility:

- `agent-runtime/workspace.ts` handles disposable workspace creation and `.bugscrub/` sync-back.
- `agent-runtime/auth.ts` handles env filtering, auth discovery, and staged agent homes.
- `agent-runtime/docker.ts` handles Docker command construction, one-shot execution, and shared session containers.
- `agent-runtime/local-runtime.ts` handles in-container app startup and readiness checks.
- `agent-runtime/browser.ts` handles `chrome-devtools` MCP configuration and Chromium DevTools preflight.

`agent-runtime/container.ts` is the facade consumed by the rest of the product. Changes that span several runtime concerns should usually be implemented in the focused submodule first, not by growing the facade.

## Why The Layers Matter

- `schemas/` protects contracts and keeps repo files strict.
- `core/` loads and resolves repo-local definitions without knowing anything about a specific agent runtime.
- `runner/` owns execution semantics: requirement normalization, capability negotiation, prompt construction, output repair, diagnostics, and reports.
- `init/` owns repository bootstrap and authoring agent orchestration.
- `generate/` owns draft inference and output writing.

If a change needs to touch both `generate/` and `runner/`, that is usually a sign the responsibility split should be revisited first.
