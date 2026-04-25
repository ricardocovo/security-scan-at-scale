# Security Scan at Scale

A Node.js/TypeScript CLI that orchestrates security scans across many GitHub repositories and multiple LLM models in parallel. For each `(repo, model)` pair it clones the repo, provisions agent primitives via `apm install`, and runs one or more fresh GitHub Copilot SDK sessions (one per configured command). Live progress is rendered in an Ink-based TUI dashboard, and outputs are persisted as per-scan Markdown reports plus an aggregated JSON/Markdown summary.

## Prerequisites

| Tool | Notes |
|---|---|
| Node.js 18+ | ESM runtime |
| `git` CLI | Required for shallow clones |
| GitHub Copilot CLI | Must be installed and authenticated (`copilot --version`) |
| `apm` CLI | Used to provision agent primitives in each cloned repo |
| `GITHUB_TOKEN` | Required for private repo access and Copilot SDK auth |

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in the example config
cp config.example.yml config.yml
# Edit config.yml: set repos, models, apmPack (optional), and one or more commands

# 3. Export your GitHub token (or add it to a .env file)
export GITHUB_TOKEN=ghp_...
# Alternatively: echo 'GITHUB_TOKEN=ghp_...' > .env
```

## Usage

```bash
# Interactive TUI (default) — config.yml is used automatically if --config is omitted
npm start
npm start -- -c config.yml

# CI / plain-log mode
npm start -- --no-ui

# Override concurrency
npm start -- --concurrency 4

# Combine flags
npm start -- -c config.yml --concurrency 4 --no-ui
```

When the run finishes the summary is written to `results/summary.md` and its path is printed to stdout. Per-scan reports are in `results/<scanId>/report.md`.

## Configuration

Copy `config.example.yml` and fill in your values:

```yaml
concurrency: 6            # max parallel (repo, model) scans
workspaceDir: ./workspaces
resultsDir: ./results

models:
  - gpt-4.1
  # - claude-sonnet-4-5

repos:
  - url: https://github.com/your-org/your-repo
    # ref: main   # optional branch/tag/SHA

# Optional: APM pack to install into each cloned repo before scanning
apmPack: ricardocovo/agent-primitives

# One or more commands (each runs in a fresh Copilot session)
commands:
  - name: "Dependency Audit"
    prompt: "..."
  - name: "Secret Scan"
    prompt: "..."
  - name: "OWASP Top 10"
    prompt: "..."

sessionTimeoutMs: 600000  # 10 minutes per session
```

## Project Structure

```
src/
  cli.ts           # commander entrypoint
  config.ts        # Zod schema + YAML loader
  orchestrator.ts  # p-queue fan-out + EventEmitter bus
  scanner.ts       # per (repo, model) pipeline
  git.ts           # shallow clone via simple-git
  apm.ts           # apm.yml provisioning + apm install
  copilot.ts       # Copilot SDK session runner
  results.ts       # report.md + summary.json/md writer
  ui/
    Dashboard.tsx  # Ink TUI dashboard
```

## Outputs

| Path | Description |
|---|---|
| `results/<scanId>/report.md` | Per-scan report with prompts, responses, tool calls, timing |
| `results/summary.json` | Machine-readable matrix of all scan results |
| `results/summary.md` | Human-readable ✅/❌ matrix linking to per-scan reports |

## Security Notes

- `GITHUB_TOKEN` is injected into clone URLs but **never** logged or written to any report.
- Use `--no-ui` in CI to avoid TTY requirements.
- Cloned repos are written to `workspaceDir` (default `./workspaces`); clean up after runs to reclaim disk space.
