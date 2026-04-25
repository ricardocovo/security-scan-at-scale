# User Story: Project scaffold and tooling

## Summary

**As a** platform engineer setting up the scanner project,
**I want** a TypeScript/Node.js project skeleton with all required dependencies and a clear folder layout,
**So that** subsequent stories can implement features against a stable, conventional foundation.

## Description

Establishes the repo's runtime, build tooling, and module layout described in the plan. No business logic is implemented in this story — only files, configs, and stub modules with the expected exports.

## Acceptance Criteria

- [ ] Given a fresh clone, when I run `npm install`, then all listed dependencies install without errors.
- [ ] Given the project, when I run `npm run build`, then `tsc --noEmit` (or `tsc`) completes with zero errors.
- [ ] Given the project, when I inspect the source tree, then every module listed in the plan exists with the documented exports (even if stubbed).
- [ ] Given a `.gitignore`, then `workspaces/`, `results/`, and `node_modules/` are ignored.
- [ ] Given `.env.example`, then it documents `GITHUB_TOKEN=`.

## Tasks

- [ ] Initialize `package.json` with `"type": "module"` and scripts: `dev` (tsx), `build` (tsc), `start` (node dist).
- [ ] Add `tsconfig.json` with `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `target: ES2022`, `outDir: dist`.
- [ ] Install runtime deps: `@github/copilot-sdk`, `simple-git`, `execa`, `zod`, `js-yaml`, `p-queue`, `ink`, `ink-spinner`, `ink-table`, `commander`, `react`.
- [ ] Install dev deps: `typescript`, `tsx`, `@types/node`, `@types/js-yaml`, `@types/react`.
- [ ] Add `.gitignore` excluding `node_modules/`, `dist/`, `workspaces/`, `results/`, `.env`.
- [ ] Add `.env.example` with `GITHUB_TOKEN=`.
- [ ] Create stub modules under `src/`: `cli.ts`, `config.ts`, `scanner.ts`, `orchestrator.ts`, `git.ts`, `apm.ts`, `copilot.ts`, `results.ts`, `ui/Dashboard.tsx`.
- [ ] Add `README.md` with setup + usage placeholders.

## Dependencies

- None (foundational story).

## Out of Scope

- Implementing any of the stub module bodies.
- Linting/ESLint setup (optional, deferred).

## Notes

- Reference the SDK install pattern in [apm_modules/ricardocovo/agent-primitives/skills/copilot-sdk/SKILL.md](../../../apm_modules/ricardocovo/agent-primitives/skills/copilot-sdk/SKILL.md).
