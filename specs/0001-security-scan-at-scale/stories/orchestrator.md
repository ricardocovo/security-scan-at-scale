# User Story: Concurrent orchestrator with event bus

## Summary

**As a** user running many scans,
**I want** the orchestrator to fan out `(repo, model)` scans through a bounded queue and expose progress events,
**So that** runs are fast, predictable, and observable while isolating individual failures.

## Description

Implements `src/orchestrator.ts` which wraps `p-queue`, enqueues one task per `(repo, model)` pair, maintains an in-memory state map keyed by scan ID, and exposes an `EventEmitter` for UI/log subscribers. Resolves with aggregated results when all tasks settle.

## Acceptance Criteria

- [ ] Given `config.concurrency = N`, when scans are enqueued, then no more than N scans run concurrently at any moment.
- [ ] Given R repos × M models, when started, then exactly R × M tasks are enqueued.
- [ ] Given any scan fails, when other scans are running or queued, then they continue and complete.
- [ ] Given the orchestrator, when subscribed to, then it emits `scan:queued`, `scan:start`, step events from `scanner`, and `scan:done`/`scan:failed`.
- [ ] Given all scans settle, when awaited, then it resolves to an array of per-scan result objects with `{ scanId, repo, model, status, durationMs, commandResults, error? }`.
- [ ] Given the in-memory state map, when queried mid-run, then it accurately reflects current status, current step, and elapsed time per scan.

## Tasks

- [ ] Implement `createOrchestrator(config)` returning `{ run(): Promise<ScanResult[]>, events: EventEmitter, getState(): StateSnapshot }`.
- [ ] Build a `p-queue` instance with `concurrency: config.concurrency`.
- [ ] Enqueue one task per `(repo, model)` pair calling `runScan` from `scanner.ts`.
- [ ] Maintain `Map<scanId, ScanState>` updated on every emitted event.
- [ ] Re-emit scanner events through the orchestrator's `EventEmitter`.
- [ ] Capture `startedAt` / `finishedAt` per scan and compute `durationMs`.
- [ ] On `run()`, await `queue.onIdle()` and return the aggregated result array.

## Dependencies

- Depends on: scan-pipeline, configuration-loader.

## Out of Scope

- Persistence of state across restarts.
- Cancellation API beyond Ctrl-C process exit.

## Notes

- Keep the event payloads small and structured — UIs should not need to re-parse strings.
