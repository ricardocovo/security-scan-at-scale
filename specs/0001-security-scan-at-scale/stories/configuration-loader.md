# User Story: Configuration schema and loader

## Summary

**As a** user of the scanner,
**I want** a single YAML config file validated by a strict schema,
**So that** I can declaratively define repos, models, prompts, and APM primitives without editing code.

## Description

Implements `src/config.ts` with a Zod schema and a YAML loader, plus a fully commented `config.example.yml` placeholder. The schema enforces the structure described in the plan, applies defaults, and fails fast on invalid input.

## Acceptance Criteria

- [ ] Given a valid `config.yml`, when `loadConfig(path)` is called, then it returns a typed config object with defaults applied.
- [ ] Given an invalid config (missing `repos`, malformed `models`, wrong number of commands), when `loadConfig` is called, then it throws a descriptive validation error.
- [ ] Given no `concurrency` set, when loaded, then it defaults to `6`.
- [ ] Given no `workspaceDir` / `resultsDir`, then they default to `./workspaces` and `./results`.
- [ ] Given no `sessionTimeoutMs`, then it defaults to `600_000`.
- [ ] Given `commands` length ≠ 3, then validation fails with a clear message.
- [ ] Given the example file is loaded, then it parses successfully (placeholders are valid).

## Tasks

- [ ] Define a Zod schema for the config with these fields: `concurrency` (default 6), `workspaceDir` (default `./workspaces`), `resultsDir` (default `./results`), `models` (string[]), `repos` (`{ url, ref? }[]`), `apmPrimitives` (string[]), `commands` (`{ name, prompt }[]`, length 3), `sessionTimeoutMs` (default 600_000).
- [ ] Export an inferred TypeScript `Config` type from the schema.
- [ ] Implement `loadConfig(path: string): Config` using `js-yaml` + Zod `safeParse`.
- [ ] Throw a `ConfigError` with a formatted Zod issue summary on invalid input.
- [ ] Author `config.example.yml` with placeholder values and inline comments for each field.

## Dependencies

- Depends on: project-scaffold (for `src/config.ts` stub and installed deps).

## Out of Scope

- Reading env vars (handled in CLI story).
- Tools allowlist field (deferred to v2).

## Notes

- Keep validation messages user-friendly — surface field paths and expected types.
