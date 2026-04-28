import { access, cp, mkdir, rename, rm } from 'fs/promises';
import { join } from 'path';
import type { ScanResult } from './scanner.js';

/**
 * Extract `owner-repo` slug from a GitHub URL.
 * Falls back to a sanitized full-URL slug for non-GitHub inputs.
 */
export function repoSlug(repoUrl: string): string {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return repoUrl
    .toLowerCase()
    .replace(/https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Collect a single scan's `.sss/` artifacts into `{resultsDir}/{owner-repo}/{model}/`,
 * also relocating `scan.log` into the destination and removing the legacy `{scanId}` folder.
 *
 * If the source `.sss/` folder is missing, mutates `result` to `failed` (with a warning)
 * and returns without copying anything.
 */
export async function collectSSSResults(
  result: ScanResult,
  resultsDir: string,
  workspaceDir: string
): Promise<void> {
  const sourceSss = join(workspaceDir, result.scanId, '.sss');
  const destDir = join(resultsDir, repoSlug(result.repo), result.model);
  const legacyScanDir = join(resultsDir, result.scanId);
  const legacyLog = join(legacyScanDir, 'scan.log');
  const destLog = join(destDir, 'scan.log');

  try {
    await access(sourceSss);
  } catch {
    const msg = `No .sss/ folder produced by scan ${result.scanId} (expected at ${sourceSss})`;
    console.warn(`WARNING: ${msg}`);
    result.status = 'failed';
    result.error = msg;
    return;
  }

  await mkdir(destDir, { recursive: true });
  await cp(sourceSss, destDir, { recursive: true });

  // Relocate scan.log if it exists, then remove the now-empty legacy folder.
  try {
    await access(legacyLog);
    await rename(legacyLog, destLog);
  } catch {
    // No scan.log to move — ignore.
  }

  await rm(legacyScanDir, { recursive: true, force: true });
}
