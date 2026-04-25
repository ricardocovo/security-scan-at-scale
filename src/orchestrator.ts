import { EventEmitter } from 'events';
import PQueue from 'p-queue';
import type { Config } from './config.js';
import { runScan, computeScanId } from './scanner.js';
import type { ScanResult, ScanStatus } from './scanner.js';

export interface ScanState {
  scanId: string;
  repo: string;
  model: string;
  status: ScanStatus;
  currentStep: string;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  error?: string;
}

export type StateSnapshot = Map<string, ScanState>;

export interface Orchestrator {
  run(): Promise<ScanResult[]>;
  events: EventEmitter;
  getState(): StateSnapshot;
}

export function createOrchestrator(config: Config, token?: string): Orchestrator {
  const events = new EventEmitter();
  const state: StateSnapshot = new Map();

  // Pre-populate state as queued
  for (const repo of config.repos) {
    for (const model of config.models) {
      const scanId = computeScanId(repo.url, model);
      state.set(scanId, {
        scanId,
        repo: repo.url,
        model,
        status: 'queued',
        currentStep: 'queued',
        startedAt: null,
        finishedAt: null,
        durationMs: null,
      });
    }
  }

  const queue = new PQueue({ concurrency: config.concurrency });
  const results: ScanResult[] = [];

  function emit(event: string, payload: Record<string, unknown>): void {
    const scanId = payload['scanId'] as string | undefined;
    if (scanId && state.has(scanId)) {
      const scan = state.get(scanId)!;
      // Update step label based on event
      if (event === 'clone:start') scan.currentStep = 'clone';
      else if (event === 'apm:start') scan.currentStep = 'apm';
      else if (event === 'command:start') {
        const index = (payload['index'] as number) ?? 0;
        scan.currentStep = `cmd ${index + 1}`;
      }
    }
    events.emit(event, payload);
  }

  async function run(): Promise<ScanResult[]> {
    for (const repo of config.repos) {
      for (const model of config.models) {
        const scanId = computeScanId(repo.url, model);

        queue.add(async () => {
          const scan = state.get(scanId)!;
          scan.status = 'running';
          scan.startedAt = Date.now();
          events.emit('scan:start', { scanId, repo: repo.url, model });

          try {
            const result = await runScan(repo, model, config, emit, token);
            scan.status = result.status;
            scan.finishedAt = result.finishedAt;
            scan.durationMs = result.durationMs;
            if (result.error) scan.error = result.error;

            if (result.status === 'done') {
              events.emit('scan:done', { scanId, result });
            } else {
              events.emit('scan:failed', { scanId, error: result.error, result });
            }

            results.push(result);
          } catch (err) {
            // Should not reach here (runScan catches internally), but guard anyway
            scan.status = 'failed';
            scan.finishedAt = Date.now();
            scan.durationMs = scan.finishedAt - (scan.startedAt ?? scan.finishedAt);
            scan.error = String(err);
            events.emit('scan:failed', { scanId, error: String(err) });

            results.push({
              scanId,
              repo: repo.url,
              model,
              status: 'failed',
              startedAt: scan.startedAt ?? 0,
              finishedAt: scan.finishedAt,
              durationMs: scan.durationMs,
              commandResults: [],
              error: String(err),
            });
          }
        });

        events.emit('scan:queued', { scanId, repo: repo.url, model });
      }
    }

    await queue.onIdle();
    return results;
  }

  return {
    run,
    events,
    getState: () => state,
  };
}

