# User Story: CLI entrypoint

## Summary

**As a** user invoking the scanner from a terminal or CI,
**I want** a `commander`-based CLI that loads config, runs the orchestrator, and reports overall success,
**So that** I can drive the whole pipeline with a single command.

## Description

Implements `src/cli.ts` as the executable entrypoint. Parses flags, validates config, ensures `GITHUB_TOKEN` is present (or warns), wires the orchestrator to either the Ink dashboard or a plain-log subscriber based on `--no-ui`, and exits with an appropriate code.

## Acceptance Criteria

- [ ] Given `-c, --config <path>`, when run, then the CLI loads that file (defaults to `config.yml`).
- [ ] Given `--concurrency <n>`, when provided, then it overrides `config.concurrency`.
- [ ] Given `--no-ui`, when provided, then the dashboard is not mounted and step transitions are written as plain stdout log lines.
- [ ] Given no `GITHUB_TOKEN` and any `repo.url` looks private, when run, then a warning is printed (but execution continues for public repos).
- [ ] Given an invalid config, when run, then the CLI prints the validation error and exits with code `1`.
- [ ] Given all scans succeed, when finished, then process exits with code `0`.
- [ ] Given any scan fails, when finished, then process exits with code `1`.
- [ ] Given the run completes, then the path to `results/summary.md` is printed last.

## Tasks

- [ ] Use `commander` to define flags `-c/--config`, `--concurrency`, `--no-ui`.
- [ ] Load and validate config via `loadConfig`; apply CLI overrides.
- [ ] Read `GITHUB_TOKEN` from `process.env`; warn if missing and any repo URL looks private.
- [ ] Construct the orchestrator and start it.
- [ ] In UI mode: mount `<Dashboard />` with the orchestrator; in `--no-ui` mode: subscribe a logger that prints structured lines like `[scanId] step → status (elapsed)`.
- [ ] After `run()` resolves, write reports + summary, print summary path, and exit with `0`/`1` based on aggregate status.
- [ ] Add `bin` entry in `package.json` mapping to `dist/cli.js` (with shebang in `cli.ts`).

## Dependencies

- Depends on: configuration-loader, orchestrator, results-writer, tui-dashboard.

## Out of Scope

- Sub-commands beyond a single default `run` action.
- Auto-detection of `GITHUB_TOKEN` from `gh auth`.

## Notes

- Plain-log mode must be deterministic and parseable for CI consumption.
