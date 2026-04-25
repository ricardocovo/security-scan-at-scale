# Feature: Security Scan at Scale

## Overview

A Node.js/TypeScript CLI that orchestrates security scans across many GitHub repositories and multiple LLM models in parallel. For each `(repo, model)` pair it clones the repo, provisions agent primitives via `apm install`, and runs three fresh GitHub Copilot SDK sessions (one per configured command). Live progress is rendered in an Ink-based TUI dashboard, and outputs are persisted as per-scan Markdown reports plus an aggregated JSON/Markdown summary.

## Problem Statement

Security teams and platform engineers want to evaluate how different LLM-driven agents perform code-level security scans across a large fleet of repositories. Doing this manually — cloning each repo, installing tooling, running multiple prompts, swapping models, and collating results — is tedious, error-prone, and not reproducible. There is no off-the-shelf orchestrator that fans out Copilot SDK sessions across `repos × models` with consistent tooling, isolation, and reporting.

## Goals

- [ ] Run scans across an arbitrary list of GitHub repositories and LLM models from a single config file.
- [ ] Provision a consistent agent toolkit in each cloned repo via `apm install` before scanning.
- [ ] Execute exactly 3 user-defined commands per `(repo, model)` pair, each in a **fresh** Copilot SDK session.
- [ ] Run scans concurrently with a configurable concurrency limit and isolate failures so one bad scan never blocks others.
- [ ] Stream live progress via a TUI dashboard, with a `--no-ui` plain-log fallback for CI.
- [ ] Produce per-scan Markdown reports plus an aggregated `summary.json` and `summary.md` matrix.

## Non-Goals

- Retries on transient failures (clone, network, model errors).
- Persistence/resume of interrupted runs.
- Streaming partial assistant deltas into the TUI body (only step + elapsed are shown live).
- Web dashboard or remote upload of results (GitHub, blob storage, etc.).
- Per-command timeouts beyond the global session timeout.
- Authoring or curating the security-scan prompts themselves (the user fills these in).

## Target Users / Personas

| Persona | Description |
|---|---|
| Security Engineer | Wants to run consistent code-aware security scans across many repos and compare model output quality. |
| Platform / DevEx Engineer | Operates the scanner in CI or on a workstation; cares about config-driven runs, isolation, and structured outputs. |
| Researcher / Evaluator | Compares LLMs (e.g. GPT vs. Claude) on identical prompts and codebases using the generated matrix report. |

## Functional Requirements

1. The system shall accept a YAML configuration file describing concurrency, workspace/results directories, models, repositories, APM primitives, commands, and an optional session timeout.
2. The system shall validate the configuration with a Zod schema and fail fast on invalid input.
3. The system shall read `GITHUB_TOKEN` from the environment and inject it into HTTPS clone URLs for private-repo access.
4. The system shall shallow-clone each repository into a per-scan workspace directory.
5. The system shall ensure an `apm.yml` exists in the cloned repo (writing/merging the configured `apmPrimitives` if needed) and run `apm install` inside the clone.
6. The system shall execute each of the 3 configured commands sequentially in a **fresh** Copilot SDK session, with `cwd` set to the clone path and `model` set per scan.
7. The system shall use an `approveAll` permission handler for unattended execution.
8. The system shall always call `await client.stop()` for every Copilot session, including on error.
9. The system shall run multiple `(repo, model)` scans in parallel via a `p-queue`, honoring `config.concurrency` (CLI flag overrides config).
10. The system shall isolate scan failures so any single failed scan does not abort the run.
11. The system shall write `results/<scanId>/report.md` per scan, containing repo URL, model, timestamps, per-command sections (prompt, final response, tool calls, duration), and any error.
12. The system shall write `results/summary.json` and `results/summary.md` (matrix of repos × models with status indicators and report links) after all scans finish.
13. The system shall render an Ink TUI by default and a plain-log mode when `--no-ui` is passed.
14. The system shall exit with code `0` if all scans succeed and `1` if any scan fails.

## Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Scale to dozens of `(repo, model)` scans in a single run with bounded concurrency; default `concurrency: 6`. |
| Reliability | Failure of one scan must not affect others; SDK sessions must always be stopped. |
| Security | Never log `GITHUB_TOKEN`; restrict tokens to clone URL + subprocess env; do not write tokens into reports. |
| Usability | Single-file config with inline-commented `config.example.yml`; Ink TUI for humans, `--no-ui` for CI. |
| Portability | Node.js 18+, ESM, runs on Linux/macOS/Windows where `git`, `apm`, and `copilot` CLIs are installed. |
| Observability | Per-scan Markdown reports + aggregated JSON/Markdown summary; tool-call traces captured in reports. |

## UX / Design Considerations

- **Primary flow**: user copies `config.example.yml` → fills in repos, models, APM primitives, and 3 prompts → exports `GITHUB_TOKEN` → runs `npm start -- --config config.yml` → watches the TUI → opens `results/summary.md` when done.
- **TUI dashboard**: live table with one row per scan, columns `Repo | Model | Step | Elapsed`. Steps cycle through `clone → apm → cmd 1 → cmd 2 → cmd 3 → done|failed`. Spinner on active rows. Footer: total / completed / failed / in-flight / queued / overall elapsed.
- **CI flow (`--no-ui`)**: plain stdout logs of step transitions per scan ID; same final summary written to disk.
- **On exit**: print path to `results/summary.md`.

## Technical Considerations

- **Runtime**: Node.js 18+, TypeScript (NodeNext, strict), ESM, `tsx` for dev, `tsc` for build.
- **Core deps**: `@github/copilot-sdk`, `simple-git`, `execa`, `zod`, `js-yaml`, `p-queue`, `ink` + `ink-spinner` + `ink-table`, `commander`.
- **Concurrency**: `p-queue` with `concurrency` from config; CLI `--concurrency` overrides.
- **Auth**: `GITHUB_TOKEN` injected as `https://x-access-token:${TOKEN}@github.com/...`; also passed through to APM and the Copilot CLI subprocesses via env.
- **Sessions**: each command runs in a new Copilot session via `createSession({ model, cwd, onPermissionRequest: approveAll, streaming: true })`; final assistant message + tool execution events are captured for the report.
- **APM behavior on repos without `apm.yml`**: write a minimal `apm.yml` with the configured `apmPrimitives` into the clone before `apm install` (Option A from the plan).
- **Module layout**: `src/cli.ts`, `src/config.ts`, `src/scanner.ts`, `src/orchestrator.ts`, `src/git.ts`, `src/apm.ts`, `src/copilot.ts`, `src/results.ts`, `src/ui/Dashboard.tsx`.
- **Event bus**: orchestrator exposes an `EventEmitter` with events like `clone:start/done`, `apm:start/done`, `command:start/done`, `scan:done/failed`; consumed by both the Ink dashboard and the plain logger.

## Dependencies

| Dependency | Type | Notes |
|---|---|---|
| GitHub Copilot CLI | External | Must be installed and authenticated (`copilot --version`). |
| `apm` CLI | External | Used to install agent primitives in each cloned repo. |
| `git` CLI | External | Required by `simple-git` for clone operations. |
| `GITHUB_TOKEN` | External (env) | Required for cloning private repos and SDK auth. |
| `@github/copilot-sdk` | npm package | Core agent runtime; see `apm_modules/ricardocovo/agent-primitives/skills/copilot-sdk/SKILL.md`. |
| Ink + helpers | npm packages | TUI rendering. |

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `GITHUB_TOKEN` leaks into logs/reports | Med | High | Centralize token handling in `git.ts`; never serialize env into reports; redact in any captured stderr. |
| Long-running model sessions block the queue | Med | Med | Enforce `sessionTimeoutMs` (default 600_000) on each session. |
| Cloned repos consume large disk space | Med | Med | Use shallow clones; document `workspaceDir` cleanup; surface path in README. |
| `apm install` fails on a target repo | Med | Med | Capture stdout/stderr, mark scan failed, continue with other scans. |
| Ink + concurrent stdout writes garble output | Low | Low | Route all logs through the event bus; disable raw `console.log` in TUI mode. |
| Rate limits / quota across many parallel sessions | Med | Med | Configurable concurrency; document recommended limits per model. |

## Success Metrics

- A run of N repos × M models produces N×M report files plus one summary, with `success`/`failed` accurately reflected.
- A failure injected into 1 of N×M scans does not affect the others.
- Dashboard never shows more than `concurrency` active rows simultaneously.
- `--no-ui` produces deterministic, parseable log lines suitable for CI.
- TypeScript build (`tsc --noEmit`) passes with zero errors.

## Open Questions

- [ ] Should we expose an `availableTools` allowlist in config for tighter sandboxing in v2?
- [ ] Should `summary.md` include aggregate timing/cost metrics per model?
- [ ] Do we need a config knob to skip `apm install` entirely for repos that already ship their own `apm.yml`?
- [ ] What output format do we want for tool-call traces in the per-scan report (collapsed JSON vs. pretty list)?

## User Stories

| Story | File |
|---|---|
| Project scaffold and tooling | [stories/project-scaffold.md](stories/project-scaffold.md) |
| Configuration schema and loader | [stories/configuration-loader.md](stories/configuration-loader.md) |
| Per-repo×model scan pipeline | [stories/scan-pipeline.md](stories/scan-pipeline.md) |
| Concurrent orchestrator with event bus | [stories/orchestrator.md](stories/orchestrator.md) |
| Results writer (reports + summary) | [stories/results-writer.md](stories/results-writer.md) |
| TUI dashboard | [stories/tui-dashboard.md](stories/tui-dashboard.md) |
| CLI entrypoint | [stories/cli-entrypoint.md](stories/cli-entrypoint.md) |
