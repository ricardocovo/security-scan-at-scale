import { z } from 'zod';
import { readFileSync } from 'fs';
import yaml from 'js-yaml';

const RepoSchema = z.object({
  url: z.string().url(),
  ref: z.string().optional(),
});

const CommandSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
});

export const ConfigSchema = z.object({
  concurrency: z.number().int().positive().default(6),
  workspaceDir: z.string().default('./workspaces'),
  resultsDir: z.string().default('./results'),
  models: z.array(z.string().min(1)).min(1),
  repos: z.array(RepoSchema).min(1),
  apmPack: z.string().min(1).optional(),
  commands: z
    .array(CommandSchema)
    .min(1, 'At least 1 command must be specified'),
  sessionTimeoutMs: z.number().int().positive().default(600_000),
});

export type Config = z.infer<typeof ConfigSchema>;
export type RepoConfig = z.infer<typeof RepoSchema>;
export type CommandConfig = z.infer<typeof CommandSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(path: string): Config {
  let raw: unknown;
  try {
    const content = readFileSync(path, 'utf8');
    raw = yaml.load(content);
  } catch (err) {
    throw new ConfigError(`Failed to read config file "${path}": ${String(err)}`);
  }

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid configuration:\n${issues}`);
  }

  return result.data;
}

