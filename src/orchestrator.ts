import { EventEmitter } from 'events';
import PQueue from 'p-queue';
import type { Config } from './config.js';
import { runScan, runSummarization, computeScanId } from './scanner.js';
import type { ScanResult, ScanStatus, SummarizationResult } from './scanner.js';
import { collectSSSResults } from './results.js';

export interface ScanState {
  scanId: string;
  repo: string;
  model: string;
  status: ScanStatus;
  currentStep: string;
  currentCommandName?: string;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  error?: string;
}

export type StateSnapshot = Map<string, ScanState>;

export interface OrchestratorRunResult {
  scans: ScanResult[];
  summarization?: SummarizationResult;
}

export interface Orchestrator {
  run(): Promise<OrchestratorRunResult>;
  events: EventEmitter;
  getState(): StateSnapshot;
}

export interface OrchestratorOptions {
  skipSecurityScan?: boolean;
}

export function createOrchestrator(
  config: Config,
  token?: string,
  options: OrchestratorOptions = {}
): Orchestrator {
  const events = new EventEmitter();
  const state: StateSnapshot = new Map();

  // Pre-populate state as queued
  if (!options.skipSecurityScan) {
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
        scan.currentCommandName = payload['name'] as string | undefined;
      }
    }
    events.emit(event, payload);
  }

  async function run(): Promise<OrchestratorRunResult> {
    if (options.skipSecurityScan) {
      events.emit('security-scan:skipped', {});
    } else {
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

              await collectSSSResults(result, config.resultsDir, config.workspaceDir);

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
              const errResult: ScanResult = {
                scanId,
                repo: repo.url,
                model,
                status: 'failed',
                startedAt: scan.startedAt ?? 0,
                finishedAt: scan.finishedAt,
                durationMs: scan.durationMs,
                commandResults: [],
                error: String(err),
              };
              await collectSSSResults(errResult, config.resultsDir, config.workspaceDir);
              events.emit('scan:failed', { scanId, error: String(err) });

              results.push(errResult);
            }
          });

          events.emit('scan:queued', { scanId, repo: repo.url, model });
        }
      }
    }

    await queue.onIdle();

    let summarization: SummarizationResult | undefined;
    if (config.summarizationCommands && config.summarizationCommands.length > 0) {
      events.emit('summarization:start', {
        model: config.summarizationModel,
        commands: config.summarizationCommands.length,
      });
      summarization = await runSummarization(config, emit, token);
      if (summarization.status === 'done') {
        events.emit('summarization:done', { result: summarization });
      } else {
        events.emit('summarization:failed', {
          error: summarization.error,
          result: summarization,
        });
      }
    }

    return { scans: results, summarization };
  }

  return {
    run,
    events,
    getState: () => state,
  };
}

