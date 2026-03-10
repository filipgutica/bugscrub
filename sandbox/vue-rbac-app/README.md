# Vue RBAC Sandbox

Small local sandbox repo for exercising BugScrub against a realistic surface with
identity switching and role-based UI differences.

## Run the app

```bash
pnpm install
pnpm dev
```

The app runs on `http://localhost:5173`.

## Validate the sandbox config

From this sandbox directory:

```bash
node --import tsx ../../src/index.ts validate
```

After building BugScrub:

```bash
node ../../dist/index.js validate
```

## What it includes

- a Vue + Vite app with admin, viewer, and auditor identities
- role-aware actions with `data-testid` hooks
- repo-local `.bugscrub/` config, surface, capabilities, assertions, signals, and a workflow
