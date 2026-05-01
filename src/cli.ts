#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';
import { loadConfig, ConfigError } from './config.js';
import { createOrchestrator } from './orchestrator.js';

program
  .name('security-scan')
  .description('Orchestrate security scans across GitHub repos × LLM models')
  .option('-c, --config <path>', 'Path to config YAML file', 'config.yml')
  .option('--concurrency <n>', 'Override concurrency from config', parseInt)
  .option('--skip-security-scan', 'Skip repo/model security scans and run summarization only')
  .option('--no-ui', 'Disable TUI; output plain log lines to stdout')
  .parse(process.argv);

const opts = program.opts<{
  config: string;
  concurrency?: number;
  skipSecurityScan?: boolean;
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

  if (!opts.skipSecurityScan && config.securityScanCommands.length === 0) {
    console.error(
      'At least 1 securityScanCommands entry is required unless --skip-security-scan is used.'
    );
    process.exit(1);
  } else if (opts.skipSecurityScan && !config.summarizationCommands?.length) {
    console.error(
      'Cannot use --skip-security-scan without summarizationCommands in the config.'
    );
    process.exit(1);
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

  // Create orchestrator
  const orchestrator = createOrchestrator(config, token, {
    skipSecurityScan: opts.skipSecurityScan,
  });

  if (opts.ui) {
    // Mount Ink TUI
    const { render } = await import('ink');
    const { Dashboard } = await import('./ui/Dashboard.js');
    const React = (await import('react')).default;

    const { unmount, waitUntilExit } = render(
      React.createElement(Dashboard, {
        events: orchestrator.events,
        getState: orchestrator.getState,
      }),
      { patchConsole: true }
    );

    // The Copilot SDK forwards its subprocess stderr directly to process.stderr,
    // bypassing Ink's patchConsole. This corrupts Ink's cursor tracking because
    // stdout and stderr share the same TTY. Suppress those raw TTY writes while
    // the TUI is active — the noise (e.g. Node.js SQLite experimental warnings)
    // is not meaningful to the user and is already captured in the scan log files.
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as NodeJS.WriteStream).write = (
      _chunk: Uint8Array | string,
      encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void
    ): boolean => {
      const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
      callback?.();
      return true;
    };

    // Run orchestrator and wait
    const { scans, summarization } = await orchestrator.run();
    orchestrator.events.emit('run:done', {});

    // Restore stderr before any teardown writes
    (process.stderr as NodeJS.WriteStream).write = originalStderrWrite as NodeJS.WriteStream['write'];

    // Let TUI render final state, then unmount
    await new Promise((resolve) => setTimeout(resolve, 500));
    unmount();
    await waitUntilExit();

    const anyFailed =
      scans.some((r) => r.status === 'failed') ||
      (summarization?.status === 'failed');
    process.exit(anyFailed ? 1 : 0);
  } else {
    // Plain log mode
    orchestrator.events.on('security-scan:skipped', () => {
      console.log('[security-scan] skipped');
    });
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
    orchestrator.events.on(
      'summarization:start',
      ({ model, commands }: { model: string; commands: number }) => {
        console.log(`[summarization] start  model=${model}  commands=${commands}`);
      }
    );
    orchestrator.events.on(
      'summarization:command:start',
      ({ index, name }: { index: number; name: string }) => {
        console.log(`[summarization] cmd ${index + 1} (${name}) → start`);
      }
    );
    orchestrator.events.on('summarization:apm:start', ({ pack }: { pack?: string }) => {
      console.log(`[summarization] apm → start${pack ? ` (${pack})` : ''}`);
    });
    orchestrator.events.on('summarization:apm:done', () => {
      console.log(`[summarization] apm → done`);
    });
    orchestrator.events.on(
      'summarization:command:done',
      ({
        index,
        name,
        status,
        elapsed,
      }: {
        index: number;
        name: string;
        status: string;
        elapsed: number;
      }) => {
        console.log(`[summarization] cmd ${index + 1} (${name}) → ${status} (${elapsed}ms)`);
      }
    );
    orchestrator.events.on('summarization:done', () => {
      console.log(`[summarization] done`);
    });
    orchestrator.events.on(
      'summarization:failed',
      ({ error }: { error: string }) => {
        console.log(`[summarization] failed: ${error}`);
      }
    );

    const { scans, summarization } = await orchestrator.run();

    const anyFailed =
      scans.some((r) => r.status === 'failed') ||
      (summarization?.status === 'failed');
    process.exit(anyFailed ? 1 : 0);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

