# User Story: TUI dashboard

## Summary

**As a** user watching a run interactively,
**I want** a live TUI dashboard showing per-scan progress and overall stats,
**So that** I can monitor long runs without tailing logs.

## Description

Implements `src/ui/Dashboard.tsx` using Ink. Subscribes to the orchestrator's `EventEmitter` and renders a live table plus a summary footer. Unmounts cleanly on completion or Ctrl-C and prints the path to `results/summary.md`.

## Acceptance Criteria

- [ ] Given an active run, when rendered, then the dashboard shows a table with columns `Repo | Model | Step | Elapsed`, one row per scan.
- [ ] Given an active scan, when it is the current step, then a spinner is shown on its row.
- [ ] Given step transitions, when emitted by the orchestrator, then the corresponding row updates without flicker.
- [ ] Given the footer, then it displays totals: total scans, completed, failed, in-flight, queued, overall elapsed.
- [ ] Given the run completes (or Ctrl-C), then Ink unmounts cleanly and the absolute path to `results/summary.md` is printed.
- [ ] Given many scans, then rows render in a stable order (queue order).

## Tasks

- [ ] Implement `Dashboard` React component consuming an orchestrator state snapshot + events.
- [ ] Use `ink-table` for the scan table and `ink-spinner` for the active row indicator.
- [ ] Map step values (`clone`, `apm`, `cmd 1..3`, `done`, `failed`) to short, human-readable labels.
- [ ] Compute elapsed time per scan from `startedAt` (tick once per second).
- [ ] Render footer with aggregated counts and overall elapsed.
- [ ] Wire SIGINT handling so Ctrl-C unmounts Ink and exits gracefully.

## Dependencies

- Depends on: orchestrator (event bus + state), results-writer (summary path).

## Out of Scope

- Streaming partial assistant deltas into the TUI body.
- Mouse interaction or scrolling controls.

## Notes

- Use a 1Hz tick (e.g. `setInterval`) only for elapsed time updates to avoid render churn.
