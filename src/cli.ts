#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';
import { resolve } from 'path';
import { loadConfig, ConfigError } from './config.js';
import { createOrchestrator } from './orchestrator.js';
import { writeReport, writeSummary } from './results.js';

program
  .name('security-scan')
  .description('Orchestrate security scans across GitHub repos × LLM models')
  .option('-c, --config <path>', 'Path to config YAML file', 'config.yml')
  .option('--concurrency <n>', 'Override concurrency from config', parseInt)
  .option('--no-ui', 'Disable TUI; output plain log lines to stdout')
  .parse(process.argv);

const opts = program.opts<{
  config: string;
  concurrency?: number;
  ui: boolean;
}>();

async function main(): Promise<void> {
  // Load and validate config
  let config;
  try {
    config = loadConfig(opts.config);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
    } else {
      console.error(String(err));
    }
    process.exit(1);
  }

  // Apply CLI overrides
  if (opts.concurrency !== undefined && !isNaN(opts.concurrency)) {
    config = { ...config, concurrency: opts.concurrency };
  }

  // Check GITHUB_TOKEN
  const token = process.env['GITHUB_TOKEN'];
  if (!token) {
    const hasPrivate = config.repos.some((r) => r.url.includes('github.com'));
    if (hasPrivate) {
      console.warn(
        'WARNING: GITHUB_TOKEN is not set. Private repository clones will fail.'
      );
    }
  }

  const summaryPath = resolve(config.resultsDir, 'summary.md');

  // Create orchestrator
  const orchestrator = createOrchestrator(config, token);

  if (opts.ui) {
    // Mount Ink TUI
    const { render } = await import('ink');
    const { Dashboard } = await import('./ui/Dashboard.js');
    const React = (await import('react')).default;

    const { unmount, waitUntilExit } = render(
      React.createElement(Dashboard, {
        events: orchestrator.events,
        getState: orchestrator.getState,
        summaryPath,
      })
    );

    // Run orchestrator and wait
    const results = await orchestrator.run();
    orchestrator.events.emit('run:done', {});

    // Write reports + summary
    await Promise.all(results.map((r) => writeReport(r, config.resultsDir)));
    await writeSummary(results, config.resultsDir, config.models);

    // Let TUI render final state, then unmount
    await new Promise((resolve) => setTimeout(resolve, 500));
    unmount();
    await waitUntilExit();

    console.log(`\nSummary written to: ${summaryPath}`);

    const anyFailed = results.some((r) => r.status === 'failed');
    process.exit(anyFailed ? 1 : 0);
  } else {
    // Plain log mode
    orchestrator.events.on('scan:queued', ({ scanId }: { scanId: string }) => {
      console.log(`[${scanId}] queued`);
    });
    orchestrator.events.on('scan:start', ({ scanId }: { scanId: string }) => {
      console.log(`[${scanId}] started`);
    });
    orchestrator.events.on('clone:start', ({ scanId }: { scanId: string }) => {
      console.log(`[${scanId}] clone → start`);
    });
    orchestrator.events.on('clone:done', ({ scanId }: { scanId: string }) => {
      console.log(`[${scanId}] clone → done`);
    });
    orchestrator.events.on('apm:start', ({ scanId }: { scanId: string }) => {
      console.log(`[${scanId}] apm → start`);
    });
    orchestrator.events.on('apm:done', ({ scanId }: { scanId: string }) => {
      console.log(`[${scanId}] apm → done`);
    });
    orchestrator.events.on(
      'command:start',
      ({ scanId, index, name }: { scanId: string; index: number; name: string }) => {
        console.log(`[${scanId}] cmd ${index + 1} (${name}) → start`);
      }
    );
    orchestrator.events.on(
      'command:done',
      ({
        scanId,
        index,
        name,
        status,
        elapsed,
      }: {
        scanId: string;
        index: number;
        name: string;
        status: string;
        elapsed: number;
      }) => {
        console.log(`[${scanId}] cmd ${index + 1} (${name}) → ${status} (${elapsed}ms)`);
      }
    );
    orchestrator.events.on(
      'scan:done',
      ({ scanId }: { scanId: string }) => {
        console.log(`[${scanId}] done`);
      }
    );
    orchestrator.events.on(
      'scan:failed',
      ({ scanId, error }: { scanId: string; error: string }) => {
        console.log(`[${scanId}] failed: ${error}`);
      }
    );

    const results = await orchestrator.run();

    await Promise.all(results.map((r) => writeReport(r, config.resultsDir)));
    await writeSummary(results, config.resultsDir, config.models);

    console.log(`\nSummary written to: ${summaryPath}`);

    const anyFailed = results.some((r) => r.status === 'failed');
    process.exit(anyFailed ? 1 : 0);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

