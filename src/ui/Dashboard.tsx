import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type { EventEmitter } from 'events';
import type { ScanState, StateSnapshot } from '../orchestrator.js';

export interface DashboardProps {
  events: EventEmitter;
  getState: () => StateSnapshot;
  onDone?: () => void;
}

const STEP_LABELS: Record<string, string> = {
  queued: 'queued',
  clone: 'cloning…',
  apm: 'apm install…',
  done: 'done',
  failed: 'failed',
};

function labelFor(step: string, commandName?: string): string {
  if (step.startsWith('cmd ') && commandName) return commandName;
  return STEP_LABELS[step] ?? step;
}

function terminalWidth(): number {
  return Math.min(process.stdout.columns ?? 120, 120);
}

function formatElapsed(startedAt: number | null, finishedAt?: number | null): string {
  if (startedAt === null) return '—';
  const ms = (finishedAt ?? Date.now()) - startedAt;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function shortRepo(url: string): string {
  return url.replace(/https?:\/\/github\.com\//i, '');
}

export const Dashboard: React.FC<DashboardProps> = ({
  events,
  getState,
  onDone,
}) => {
  const { exit } = useApp();
  const [rows, setRows] = useState<ScanState[]>(() =>
    Array.from(getState().values())
  );
  const [tick, setTick] = useState(0);
  const [runDone, setRunDone] = useState(false);
  const [securityScanSkipped, setSecurityScanSkipped] = useState(false);
  const [overallStart] = useState(() => Date.now());

  type SummarizationPhase = {
    status: 'idle' | 'running' | 'done' | 'failed';
    model?: string;
    totalCommands?: number;
    currentIndex?: number;
    currentName?: string;
    completed: { name: string; status: string; elapsed: number }[];
    error?: string;
  };
  const [summarization, setSummarization] = useState<SummarizationPhase>({
    status: 'idle',
    completed: [],
  });

  // Summarization phase events
  useEffect(() => {
    const onStart = ({ model, commands }: { model: string; commands: number }) => {
      setSummarization({
        status: 'running',
        model,
        totalCommands: commands,
        completed: [],
      });
    };
    const onCmdStart = ({ index, name }: { index: number; name: string }) => {
      setSummarization((s) => ({ ...s, currentIndex: index, currentName: name }));
    };
    const onApmStart = () => {
      setSummarization((s) => ({ ...s, currentName: 'apm install' }));
    };
    const onApmDone = () => {
      setSummarization((s) => ({ ...s, currentName: undefined }));
    };
    const onCmdDone = ({
      name,
      status,
      elapsed,
    }: {
      name: string;
      status: string;
      elapsed: number;
    }) => {
      setSummarization((s) => ({
        ...s,
        completed: [...s.completed, { name, status, elapsed }],
      }));
    };
    const onDone = () => {
      setSummarization((s) => ({ ...s, status: 'done', currentName: undefined }));
    };
    const onFailed = ({ error }: { error?: string }) => {
      setSummarization((s) => ({
        ...s,
        status: 'failed',
        currentName: undefined,
        error,
      }));
    };
    events.on('summarization:start', onStart);
    events.on('summarization:apm:start', onApmStart);
    events.on('summarization:apm:done', onApmDone);
    events.on('summarization:command:start', onCmdStart);
    events.on('summarization:command:done', onCmdDone);
    events.on('summarization:done', onDone);
    events.on('summarization:failed', onFailed);
    return () => {
      events.off('summarization:start', onStart);
      events.off('summarization:apm:start', onApmStart);
      events.off('summarization:apm:done', onApmDone);
      events.off('summarization:command:start', onCmdStart);
      events.off('summarization:command:done', onCmdDone);
      events.off('summarization:done', onDone);
      events.off('summarization:failed', onFailed);
    };
  }, [events]);

  // Refresh rows on any orchestrator event
  useEffect(() => {
    const refresh = () => setRows(Array.from(getState().values()));
    const onSkipped = () => {
      setSecurityScanSkipped(true);
      refresh();
    };
    const eventNames = [
      'scan:queued',
      'scan:start',
      'scan:done',
      'scan:failed',
      'clone:start',
      'clone:done',
      'apm:start',
      'apm:done',
      'command:start',
      'command:done',
    ];
    eventNames.forEach((e) => events.on(e, refresh));
    events.on('security-scan:skipped', onSkipped);
    return () => {
      eventNames.forEach((e) => events.off(e, refresh));
      events.off('security-scan:skipped', onSkipped);
    };
  }, [events, getState]);

  // Tick every second for elapsed time updates
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Watch for run completion
  useEffect(() => {
    const onIdle = () => {
      setRunDone(true);
      onDone?.();
    };
    events.on('run:done', onIdle);
    return () => {
      events.off('run:done', onIdle);
    };
  }, [events, onDone, exit]);

  // Handle Ctrl-C
  useEffect(() => {
    const handleSigint = () => {
      exit();
    };
    process.on('SIGINT', handleSigint);
    return () => {
      process.off('SIGINT', handleSigint);
    };
  }, [exit]);

  const total = rows.length;
  const completed = rows.filter((r) => r.status === 'done').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const inFlight = rows.filter((r) => r.status === 'running').length;
  const queued = rows.filter((r) => r.status === 'queued').length;
  const tWidth = terminalWidth();
  // Column widths: STEP_W is fixed (longest label is "running cmd 1" = 13 chars)
  // REPO_W absorbs the remaining space
  const SPINNER_W = 2;
  const ELAPSED_W = 10;
  const MODEL_W = 22;
  const STEP_W = 16;
  const REPO_W = Math.max(20, tWidth - SPINNER_W - ELAPSED_W - MODEL_W - STEP_W - 4);
  const divider = '-'.repeat(tWidth);

  // Stable row order: preserve insertion order (queue order)
  const stableRows = rows;

  return (
    <Box flexDirection="column">
      <Text>{''}</Text>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Security Scan at Scale
        </Text>
      </Box>

      {/* Table header */}
      <Box>
        <Text bold>{padRight('Repository', SPINNER_W + REPO_W)}</Text>
        <Text bold>{padRight('Model', MODEL_W)}</Text>
        <Text bold>{padRight('Step', STEP_W)}</Text>
        <Text bold>{'Elapsed'}</Text>
      </Box>
      <Box>
        <Text dimColor>{divider}</Text>
      </Box>

      {securityScanSkipped && (
        <Box>
          <Text color="yellow">Security scan skipped; running summarization only.</Text>
        </Box>
      )}

      {/* Scan rows */}
      {stableRows.map((row) => {
        const isActive = row.status === 'running';
        const isDone = row.status === 'done';
        const isFailed = row.status === 'failed';
        const color = isDone ? 'green' : isFailed ? 'red' : undefined;

        return (
          <Box key={row.scanId}>
            <Box width={SPINNER_W}>
              {isActive ? (
                <Text color="yellow">
                  <Spinner type="dots" />
                </Text>
              ) : (
                <Text> </Text>
              )}
            </Box>
            <Text color={color}>{padRight(shortRepo(row.repo), REPO_W)}</Text>
            <Text color={color}>{padRight(row.model, MODEL_W)}</Text>
            <Text color={color}>{padRight(labelFor(row.currentStep, row.currentCommandName), STEP_W)}</Text>
            <Text color={color}>
              {isActive || isDone || isFailed ? formatElapsed(row.startedAt, isDone || isFailed ? row.finishedAt : null) : '—'}
            </Text>
          </Box>
        );
      })}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>{divider}</Text>
      </Box>
      <Box>
        <Text>
          {'Total: '}
          <Text bold>{total}</Text>
          {'  ✅ '}
          <Text color="green" bold>
            {completed}
          </Text>
          {'  ❌ '}
          <Text color="red" bold>
            {failed}
          </Text>
          {'  ⏳ in-flight: '}
          <Text color="yellow" bold>
            {inFlight}
          </Text>
          {'  queued: '}
          <Text bold>{queued}</Text>
          {'  overall: '}
          <Text bold>{formatElapsed(overallStart, runDone ? undefined : undefined)}</Text>
        </Text>
      </Box>

      {/* Summarization phase */}
      {summarization.status !== 'idle' && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text bold color="cyan">Summarization</Text>
            <Text>{'  '}</Text>
            {summarization.status === 'running' && (
              <Text color="yellow">
                <Spinner type="dots" />
                {' running'}
                {summarization.model ? ` (${summarization.model})` : ''}
              </Text>
            )}
            {summarization.status === 'done' && (
              <Text color="green" bold>done</Text>
            )}
            {summarization.status === 'failed' && (
              <Text color="red" bold>failed{summarization.error ? `: ${summarization.error}` : ''}</Text>
            )}
          </Box>
          {summarization.completed.map((c, i) => (
            <Box key={`sum-done-${i}`}>
              <Text color={c.status === 'done' ? 'green' : 'red'}>
                {`  ✓ ${c.name} — ${c.status} (${Math.round(c.elapsed / 1000)}s)`}
              </Text>
            </Box>
          ))}
          {summarization.status === 'running' && summarization.currentName && (
            <Box>
              <Text color="yellow">{`  → ${summarization.currentName}`}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Completion message */}
      {runDone && (
        <Box marginTop={1} flexDirection="column">
          <Text color="green" bold>
            Run complete!
          </Text>
        </Box>
      )}

      {/* Force tick read to re-render for elapsed time */}
      {tick < 0 && null}
    </Box>
  );
};

function padRight(s: string, len: number): string {
  if (s.length >= len) return s.slice(0, len - 1) + ' ';
  return s + ' '.repeat(len - s.length);
}

