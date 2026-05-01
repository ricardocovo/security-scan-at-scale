import { join } from 'path';
import { mkdir, appendFile } from 'fs/promises';
import type { Config, RepoConfig } from './config.js';
import { cloneRepo } from './git.js';
import { runApmInstall } from './apm.js';
import { runCommand } from './copilot.js';
import type { CommandResult } from './copilot.js';

async function createScanLogger(logPath: string): Promise<(msg: string) => Promise<void>> {
  await mkdir(join(logPath, '..'), { recursive: true });
  return async (msg: string): Promise<void> => {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    await appendFile(logPath, line, 'utf8');
  };
}

export type ScanStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ScanResult {
  scanId: string;
  repo: string;
  model: string;
  status: ScanStatus;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  commandResults: CommandResult[];
  error?: string;
}

export type EmitFn = (event: string, payload: Record<string, unknown>) => void;

/**
 * Compute a filesystem-safe scan ID from a repo URL and model name.
 */
export function computeScanId(repoUrl: string, model: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/https?:\/\//, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return `${slug(repoUrl)}__${slug(model)}`;
}

/**
 * Run a full (repo × model) scan:
 *   1. Clone repo
 *   2. Ensure apm.yml + run apm install
 *   3. Run 3 commands in fresh Copilot sessions
 */
export async function runScan(
  repo: RepoConfig,
  model: string,
  config: Config,
  emit: EmitFn,
  token?: string
): Promise<ScanResult> {
  const scanId = computeScanId(repo.url, model);
  const clonePath = join(config.workspaceDir, scanId);
  const logPath = join(config.resultsDir, scanId, 'scan.log');
  const startedAt = Date.now();
  const commandResults: CommandResult[] = [];

  const log = await createScanLogger(logPath);
  await log(`scan:start  repo=${repo.url}  model=${model}`);

  const result: ScanResult = {
    scanId,
    repo: repo.url,
    model,
    status: 'running',
    startedAt,
    finishedAt: 0,
    durationMs: 0,
    commandResults,
  };

  try {
    // Step 1: Clone
    emit('clone:start', { scanId, repo: repo.url });
    await log(`clone:start  repo=${repo.url}`);
    await cloneRepo(repo.url, repo.ref, clonePath, token);
    await log(`clone:done`);
    emit('clone:done', { scanId, repo: repo.url });

    // Step 2: APM install
    emit('apm:start', { scanId });
    await log(`apm:start`);
    const apmEnv: Record<string, string> = token ? { GITHUB_TOKEN: token } : {};
    await runApmInstall(clonePath, config.apmPack, apmEnv);
    await log(`apm:done`);
    emit('apm:done', { scanId });

    // Step 3: Run security scan commands
    for (let i = 0; i < config.securityScanCommands.length; i++) {
      const cmd = config.securityScanCommands[i];
      const cmdStartedAt = Date.now();
      emit('command:start', { scanId, index: i, name: cmd.name });
      await log(`command:start  index=${i}  name=${cmd.name}`);

      const cmdResult = await runCommand({
        model,
        cwd: clonePath,
        prompt: cmd.prompt,
        name: cmd.name,
        timeoutMs: config.sessionTimeoutMs,
        token,
      });

      const elapsed = Date.now() - cmdStartedAt;
      await log(
        `command:done  index=${i}  name=${cmd.name}  status=${cmdResult.status}  elapsed=${elapsed}ms` +
        (cmdResult.error ? `  error=${cmdResult.error}` : '')
      );
      commandResults.push(cmdResult);
      emit('command:done', {
        scanId,
        index: i,
        name: cmd.name,
        status: cmdResult.status,
        elapsed: Date.now() - cmdStartedAt,
      });
    }

    result.status = 'done';
    await log(`scan:done  duration=${Date.now() - startedAt}ms`);
  } catch (err) {
    result.status = 'failed';
    result.error = String(err);
    await log(`scan:failed  error=${String(err)}`);
  }

  result.finishedAt = Date.now();
  result.durationMs = result.finishedAt - startedAt;
  return result;
}

export type SummarizationStatus = 'running' | 'done' | 'failed';

export interface SummarizationResult {
  status: SummarizationStatus;
  model: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  commandResults: CommandResult[];
  error?: string;
}

/**
 * Run summarization commands once globally over the results folder, after all
 * per-(repo, model) security scans have completed.
 *
 * - installs `config.summarizationApmPack` into `config.resultsDir`, if set
 * - cwd is `config.resultsDir`
 * - model is `config.summarizationModel`
 * - commands run sequentially in fresh Copilot sessions
 */
export async function runSummarization(
  config: Config,
  emit: EmitFn,
  token?: string
): Promise<SummarizationResult> {
  const commands = config.summarizationCommands ?? [];
  const model = config.summarizationModel!;
  const cwd = config.resultsDir;
  const logPath = join(config.resultsDir, 'summarization.log');
  const startedAt = Date.now();
  const commandResults: CommandResult[] = [];

  await mkdir(cwd, { recursive: true });
  const log = await createScanLogger(logPath);
  await log(`summarization:start  model=${model}  cwd=${cwd}  commands=${commands.length}`);

  const result: SummarizationResult = {
    status: 'running',
    model,
    startedAt,
    finishedAt: 0,
    durationMs: 0,
    commandResults,
  };

  try {
    emit('summarization:apm:start', { pack: config.summarizationApmPack });
    await log(`summarization:apm:start  pack=${config.summarizationApmPack ?? '(none)'}`);
    const apmEnv: Record<string, string> = token ? { GITHUB_TOKEN: token } : {};
    await runApmInstall(cwd, config.summarizationApmPack, apmEnv);
    await log(`summarization:apm:done`);
    emit('summarization:apm:done', { pack: config.summarizationApmPack });

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const cmdStartedAt = Date.now();
      emit('summarization:command:start', { index: i, name: cmd.name });
      await log(`summarization:command:start  index=${i}  name=${cmd.name}`);

      const cmdResult = await runCommand({
        model,
        cwd,
        prompt: cmd.prompt,
        name: cmd.name,
        timeoutMs: config.sessionTimeoutMs,
        token,
      });

      const elapsed = Date.now() - cmdStartedAt;
      commandResults.push(cmdResult);
      await log(
        `summarization:command:done  index=${i}  name=${cmd.name}  status=${cmdResult.status}  elapsed=${elapsed}ms` +
        (cmdResult.error ? `  error=${cmdResult.error}` : '')
      );
      emit('summarization:command:done', {
        index: i,
        name: cmd.name,
        status: cmdResult.status,
        elapsed,
      });

      if (cmdResult.status === 'failed') {
        throw new Error(cmdResult.error ?? `Summarization command "${cmd.name}" failed`);
      }
    }

    result.status = 'done';
    await log(`summarization:done  duration=${Date.now() - startedAt}ms`);
  } catch (err) {
    result.status = 'failed';
    result.error = String(err);
    await log(`summarization:failed  error=${String(err)}`);
  }

  result.finishedAt = Date.now();
  result.durationMs = result.finishedAt - startedAt;
  return result;
}

