import { simpleGit } from 'simple-git';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * Shallow-clone a repository into `dest`.
 * If `token` is provided, it is injected into the HTTPS URL for private-repo access.
 * The token is NEVER written to logs or reports.
 * Any existing directory at `dest` is removed before cloning.
 */
export async function cloneRepo(
  url: string,
  ref: string | undefined,
  dest: string,
  token: string | undefined
): Promise<void> {
  const cloneUrl = token ? injectToken(url, token) : url;

  if (existsSync(dest)) {
    await rm(dest, { recursive: true, force: true });
  }

  const args: string[] = ['--depth', '1'];
  if (ref) {
    args.push('--branch', ref);
  }

  const git = simpleGit();
  await git.clone(cloneUrl, dest, args);
}

function injectToken(url: string, token: string): string {
  // Only inject into HTTPS GitHub URLs.
  const parsed = new URL(url);
  if (parsed.protocol === 'https:' && parsed.hostname === 'github.com') {
    parsed.username = 'x-access-token';
    parsed.password = token;
    return parsed.toString();
  }
  return url;
}

