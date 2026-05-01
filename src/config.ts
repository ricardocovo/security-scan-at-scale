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

export const ConfigSchema = z
  .object({
    concurrency: z.number().int().positive().default(6),
    workspaceDir: z.string().default('./workspaces'),
    resultsDir: z.string().default('./results'),
    models: z.array(z.string().min(1)).min(1),
    repos: z.array(RepoSchema).min(1),
    apmPack: z.string().min(1).optional(),
    securityScanCommands: z.array(CommandSchema).default([]),
    summarizationCommands: z.array(CommandSchema).optional(),
    summarizationModel: z.string().min(1).optional(),
    summarizationApmPack: z.string().min(1).optional(),
    sessionTimeoutMs: z.number().int().positive().default(600_000),
  })
  .superRefine((cfg, ctx) => {
    const hasCmds = !!cfg.summarizationCommands && cfg.summarizationCommands.length > 0;
    const hasModel = !!cfg.summarizationModel;
    if (hasCmds && !hasModel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summarizationModel'],
        message: 'summarizationModel is required when summarizationCommands is set',
      });
    }
    if (hasModel && !hasCmds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summarizationCommands'],
        message: 'summarizationCommands is required when summarizationModel is set',
      });
    }
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

