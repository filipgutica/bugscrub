# Agent handoff

You are authoring BugScrub workspace files for `.`.

Required work:
- Inspect the selected package directly; do not rely only on this summary.
- Replace placeholder values in `.bugscrub/bugscrub.config.yaml` where needed.
- Create repo-specific surfaces under `.bugscrub/surfaces/<surface>/`.
- Create repo-specific workflows under `.bugscrub/workflows/`.
- Keep all generated YAML valid against the shipped BugScrub schemas.
- Run `bugscrub validate` after writing files and fix any reported issues.

Suggested repo context to review first:
- package.json
- vite.config.js
- src/App.vue
- src/main.js