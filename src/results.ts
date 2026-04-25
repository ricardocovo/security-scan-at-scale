import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { ScanResult } from './scanner.js';
import type { CommandResult } from './copilot.js';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderToolEvents(toolEvents: unknown[]): string {
  if (toolEvents.length === 0) return '_No tool calls._';
  return `\`\`\`json\n${JSON.stringify(toolEvents, null, 2)}\n\`\`\``;
}

function renderCommandSection(cmd: CommandResult, index: number): string {
  const statusIcon = cmd.status === 'success' ? '✅' : '❌';
  const lines: string[] = [
    `### Command ${index + 1}: ${cmd.name} ${statusIcon}`,
    '',
    `**Duration:** ${formatDuration(cmd.durationMs)}`,
    '',
    '**Prompt:**',
    '',
    '```',
    cmd.prompt.trim(),
    '```',
    '',
    '**Response:**',
    '',
    cmd.response ? cmd.response.trim() : '_No response captured._',
    '',
  ];

  if (cmd.error) {
    lines.push('**Error:**', '', `> ${cmd.error}`, '');
  }

  lines.push(
    '<details>',
    '<summary>Tool Calls</summary>',
    '',
    renderToolEvents(cmd.toolEvents),
    '',
    '</details>',
    ''
  );

  return lines.join('\n');
}

export async function writeReport(
  result: ScanResult,
  resultsDir: string
): Promise<void> {
  const scanDir = join(resultsDir, result.scanId);
  await mkdir(scanDir, { recursive: true });

  const lines: string[] = [
    `# Scan Report: ${result.scanId}`,
    '',
    `| Field | Value |`,
    `|---|---|`,
    `| **Repository** | ${result.repo} |`,
    `| **Model** | ${result.model} |`,
    `| **Status** | ${result.status === 'done' ? '✅ done' : '❌ failed'} |`,
    `| **Started** | ${new Date(result.startedAt).toISOString()} |`,
    `| **Finished** | ${new Date(result.finishedAt).toISOString()} |`,
    `| **Duration** | ${formatDuration(result.durationMs)} |`,
    '',
  ];

  if (result.error) {
    lines.push('## Error', '', `> ${result.error}`, '');
  }

  lines.push('## Commands', '');
  if (result.commandResults.length === 0) {
    lines.push('_No commands were executed._', '');
  } else {
    for (let i = 0; i < result.commandResults.length; i++) {
      lines.push(renderCommandSection(result.commandResults[i], i));
    }
  }

  await writeFile(join(scanDir, 'report.md'), lines.join('\n'), 'utf8');
}

export interface SummaryEntry {
  scanId: string;
  repo: string;
  model: string;
  status: string;
  durationMs: number;
  commands: { name: string; status: string; durationMs: number }[];
  reportPath: string;
}

export async function writeSummary(
  results: ScanResult[],
  resultsDir: string,
  models: string[]
): Promise<void> {
  await mkdir(resultsDir, { recursive: true });

  // Build summary JSON
  const summaryEntries: SummaryEntry[] = results.map((r) => ({
    scanId: r.scanId,
    repo: r.repo,
    model: r.model,
    status: r.status,
    durationMs: r.durationMs,
    commands: r.commandResults.map((c) => ({
      name: c.name,
      status: c.status,
      durationMs: c.durationMs,
    })),
    reportPath: `${r.scanId}/report.md`,
  }));

  await writeFile(
    join(resultsDir, 'summary.json'),
    JSON.stringify(summaryEntries, null, 2),
    'utf8'
  );

  // Build summary Markdown matrix
  // Rows = repos (unique, in order of first appearance), Columns = models
  const reposOrdered: string[] = [];
  const seenRepos = new Set<string>();
  for (const r of results) {
    if (!seenRepos.has(r.repo)) {
      seenRepos.add(r.repo);
      reposOrdered.push(r.repo);
    }
  }

  // Index results by (repo, model)
  const resultMap = new Map<string, ScanResult>();
  for (const r of results) {
    resultMap.set(`${r.repo}::${r.model}`, r);
  }

  const header = `| Repository | ${models.join(' | ')} |`;
  const separator = `|---|${models.map(() => '---').join('|')}|`;

  const rows = reposOrdered.map((repo) => {
    const repoLabel = repo.replace(/https?:\/\/github\.com\//i, '');
    const cells = models.map((model) => {
      const r = resultMap.get(`${repo}::${model}`);
      if (!r) return '—';
      const icon = r.status === 'done' ? '✅' : '❌';
      return `[${icon}](./${r.scanId}/report.md)`;
    });
    return `| \`${repoLabel}\` | ${cells.join(' | ')} |`;
  });

  const mdLines: string[] = [
    '# Scan Summary',
    '',
    `**Generated:** ${new Date().toISOString()}`,
    `**Total scans:** ${results.length}`,
    `**Succeeded:** ${results.filter((r) => r.status === 'done').length}`,
    `**Failed:** ${results.filter((r) => r.status === 'failed').length}`,
    '',
    '## Results Matrix',
    '',
    header,
    separator,
    ...rows,
    '',
  ];

  await writeFile(
    join(resultsDir, 'summary.md'),
    mdLines.join('\n'),
    'utf8'
  );
}

