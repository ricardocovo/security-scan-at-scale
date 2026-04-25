# User Story: Results writer (reports + summary)

## Summary

**As a** user reviewing scan output,
**I want** per-scan Markdown reports plus an aggregated JSON and Markdown summary,
**So that** I can audit individual runs and compare repos × models at a glance.

## Description

Implements `src/results.ts` to persist outputs under `config.resultsDir`. Each scan gets `results/<scanId>/report.md`. After all scans finish, the writer produces `results/summary.json` and `results/summary.md` (a matrix table of repos × models).

## Acceptance Criteria

- [ ] Given a completed scan, when `writeReport(result)` is called, then `results/<scanId>/report.md` exists containing repo URL, model, timestamps, per-command sections (prompt, final response, tool calls, duration), and any error.
- [ ] Given all scans finish, when `writeSummary(results)` is called, then `results/summary.json` contains an array of `{ scanId, repo, model, status, durationMs, commands: [{ name, status, durationMs }], reportPath }`.
- [ ] Given all scans finish, then `results/summary.md` renders a matrix with rows = repos, columns = models, cells showing ✅/❌ and a relative link to the per-scan report.
- [ ] Given a failed scan, then its report still renders with the captured error and any partial command results.
- [ ] Given a scan ID, then output paths are filesystem-safe (slugified).

## Tasks

- [ ] Implement `writeReport(result, resultsDir)` rendering Markdown sections per command.
- [ ] Implement `writeSummary(results, resultsDir)` writing `summary.json` and `summary.md`.
- [ ] Render `summary.md` matrix using a deterministic column order from the original `models` list.
- [ ] Ensure parent directories exist (`fs.mkdir({ recursive: true })`).
- [ ] Format durations as human-readable strings (e.g. `12.3s`) in Markdown but keep raw `ms` in JSON.
- [ ] Include tool execution events in the report under a collapsible/code-fenced section.

## Dependencies

- Depends on: scan-pipeline (result shape), orchestrator (aggregated results).

## Out of Scope

- Uploading results to remote storage.
- HTML rendering.

## Notes

- Never include `GITHUB_TOKEN` or full env in any report.
