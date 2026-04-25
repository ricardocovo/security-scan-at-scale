import { execa } from 'execa';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

/**
 * Run `apm install <pack>` inside `cwd`, passing the provided env variables.
 * If no pack is specified, does nothing.
 * Any existing `apm.yml` in the repo is removed first so the install is clean.
 */
export async function runApmInstall(
  cwd: string,
  pack: string | undefined,
  env: Record<string, string>
): Promise<void> {
  if (!pack) {
    return;
  }
  const apmYmlPath = join(cwd, 'apm.yml');
  if (existsSync(apmYmlPath)) {
    rmSync(apmYmlPath);
  }
  await execa('apm', ['install', pack], {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
}

