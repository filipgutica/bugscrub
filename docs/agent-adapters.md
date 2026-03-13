# Adding An AgentAdapter

Use `AgentAdapter` as the only runtime-facing term in code and docs. Avoid introducing new names like "handler" or "harness" unless they mean something narrower than the adapter itself.

## Required Interface

Every adapter must implement the contract in [`src/runner/agent/types.ts`](/Users/filip.gutica@konghq.com/code/bugscrub/src/runner/agent/types.ts):

- `name`
- `detect()`
- `getCapabilities()`
- `run(context)`

The adapter should assume `context.prompt` is already final. It should not rebuild prompt sections on its own.

## Implementation Checklist

1. Add the adapter module under `src/runner/agent/`.
2. Implement `detect()` with a cheap local runtime check.
3. Return truthful capability flags from `getCapabilities()`.
4. Enforce the same dangerous-permissions policy as existing adapters.
5. Reuse `runCommand()` for subprocess execution unless there is a strong reason not to.
6. Return a normalized `AdapterRunOutput` with raw stdout/stderr artifacts preserved.
7. Implement `repairOutput(...)` if the runtime can return corrected structured output without rerunning the workflow.
8. Register the adapter in runtime selection code and tests.

## Capability Rules

- Do not overstate support. Capability negotiation should fail fast before the agent runs.
- Keep alias handling in `src/runner/negotiator.ts` aligned with any new capability shapes.
- If an adapter only partially supports a feature, model that limitation explicitly rather than silently degrading.

## Security Expectations

- Avoid inheriting the full parent environment unless a variable is required for the runtime.
- Prefer explicit env allowlists and redact sensitive values from stored transcripts/logs.
- Prefer the least-permissive runtime mode that still lets the adapter inspect the repo and produce its structured result.
- Do not bypass sandbox or permission checks by default.
- Treat browser MCP setup and Chromium preflight as runtime-layer concerns. Adapters should assume the container runtime has already prepared that environment.

## Test Expectations

- Unit test `detect()` and `getCapabilities()`.
- Unit test the dangerous-permissions gate.
- Integration test that the adapter receives the same prebuilt prompt that BugScrub writes to artifacts.
- Test repair-only structured-output behavior if the adapter supports `repairOutput(...)`.
- Add or update negotiation coverage if capability handling changes.

## Future Adapter TODOs

- `opencode`: verify how it exposes structured output, permissions, and browser capabilities.
- `gemini`: decide whether the adapter is CLI-driven, API-driven, or both before adding any runtime contract.
- `copilot`: clarify whether the runtime can operate non-interactively enough for `run` and authoring flows.
- Any new adapter: document runtime installation, auth env vars, and any manual smoke checks required before release.
