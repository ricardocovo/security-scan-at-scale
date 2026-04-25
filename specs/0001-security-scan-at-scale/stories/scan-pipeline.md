# User Story: Per-repo×model scan pipeline

## Summary

**As a** security engineer,
**I want** the scanner to clone each repo, install agent primitives, and run 3 fresh Copilot sessions per model,
**So that** every `(repo, model)` pair is scanned consistently and in isolation.

## Description

Implements `src/git.ts`, `src/apm.ts`, `src/copilot.ts`, and `src/scanner.ts`. Each `runScan(repo, model, config, emit)` invocation walks through clone → apm install → 3 sequential commands, emitting lifecycle events and capturing per-command results. Failures are caught and recorded so the orchestrator can continue.

## Acceptance Criteria

- [ ] Given a `(repo, model)` pair, when `runScan` is called, then a unique `scanId = ${slugify(repo)}__${model}` is computed.
- [ ] Given `GITHUB_TOKEN` is set, when cloning, then the token is injected into the HTTPS URL (`https://x-access-token:${TOKEN}@...`) and never written to logs or reports.
- [ ] Given a non-empty `apmPrimitives`, when the cloned repo lacks `apm.yml`, then a minimal `apm.yml` listing those primitives is written before running `apm install`.
- [ ] Given the clone succeeds, when `apm install` runs, then its stdout/stderr lines are emitted as events.
- [ ] Given each of the 3 commands, when executed, then a fresh Copilot session is created with `model`, `cwd = clone path`, `onPermissionRequest: approveAll`, `streaming: true`.
- [ ] Given a session, when complete, then the assistant's final message and any tool execution events are captured for the report, and `await client.stop()` is called in `finally`.
- [ ] Given any I/O failure, when caught, then the scan is marked `failed` with the error preserved and the function returns rather than throwing.
- [ ] Given lifecycle progress, then events `clone:start/done`, `apm:start/done`, `command:start/done` (with index, name, elapsed) are emitted.

## Tasks

- [ ] Implement `src/git.ts` with `cloneRepo(url, ref, dest, token)` using `simple-git` (shallow, branch=ref).
- [ ] Implement `src/apm.ts` with `runApmInstall(cwd, env)` using `execa`, streaming output line-by-line.
- [ ] Implement `src/apm.ts` helper to write/merge a minimal `apm.yml` from `apmPrimitives` if missing.
- [ ] Implement `src/copilot.ts` exposing `runCommand({ model, cwd, prompt, timeoutMs })` that creates a session, sends the prompt, collects final message + tool events, and always stops the client in `finally`.
- [ ] Implement `src/scanner.ts` `runScan(repo, model, config, emit)` orchestrating the 6 steps from the plan.
- [ ] Compute `scanId` via a `slugify` helper (lowercase, replace non-alphanum with `-`).
- [ ] Wrap each step in try/catch, recording per-step status and elapsed time in the returned result object.
- [ ] Ensure `GITHUB_TOKEN` is propagated to `apm` and Copilot subprocess env.

## Dependencies

- Depends on: configuration-loader (for typed `Config`), project-scaffold.

## Out of Scope

- Concurrency / queueing (handled in orchestrator story).
- Writing reports to disk (handled in results-writer story).
- TUI rendering of progress (handled in tui-dashboard story).

## Notes

- Mirror the TypeScript "Custom Tools", "Streaming Responses", and "Graceful Shutdown" patterns from [apm_modules/ricardocovo/agent-primitives/skills/copilot-sdk/SKILL.md](../../../apm_modules/ricardocovo/agent-primitives/skills/copilot-sdk/SKILL.md).
- Always `await client.stop()` in `finally` — non-negotiable.
