# BugScrub Architecture

BugScrub keeps repo-defined exploratory intent separate from agent-specific runtime details.

## End-to-End Flow

```mermaid
flowchart LR
  A["init"] --> B["detect project + tests"]
  B --> C["write minimal .bugscrub scaffold"]
  C --> D["authoring agent fills repo-specific surfaces/workflows"]
  D --> E["validate generated files"]
  E --> F["discover"]
  F --> G["scan repo + existing .bugscrub files"]
  G --> H["author missing surfaces/workflows only"]
  H --> I["generate"]
  I --> J["read one source of truth"]
  J --> K["draft workflow YAML"]
  K --> L["run"]
  L --> M["load config + workflow + surfaces"]
  M --> N["resolve refs + negotiate adapter capabilities"]
  N --> O["build prompt once"]
  O --> P["AgentAdapter run"]
  P --> Q["reports + artifacts"]
```

## Core Boundaries

- Repo state lives under `.bugscrub/`. That is the product surface.
- `init` and `discover` are authoring/bootstrap flows. They should not own workflow execution semantics.
- `generate` creates deterministic draft YAML from local evidence like routes, tests, diffs, or an existing workflow.
- `run` is the only place that resolves a workflow into a full `RunContext` and invokes an `AgentAdapter`.
- Agent adapters are replaceable runtimes. They receive a prepared `RunContext` and return an `AdapterRunOutput`.

## Why The Layers Matter

- `schemas/` protects contracts and keeps repo files strict.
- `core/` loads and resolves repo-local definitions without knowing anything about a specific agent runtime.
- `runner/` owns execution semantics: prompt construction, capability negotiation, diagnostics, and reports.
- `init/` owns repository bootstrap and authoring agent orchestration.
- `generate/` owns draft inference and output writing.

If a change needs to touch both `generate/` and `runner/`, that is usually a sign the responsibility split should be revisited first.
