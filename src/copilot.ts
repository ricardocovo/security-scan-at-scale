import { CopilotClient, approveAll } from '@github/copilot-sdk';
import type { SessionEvent } from '@github/copilot-sdk';

// Capture the REAL process.stdout.write exactly once at module load. We use a
// reference-counted suppression so concurrent scans that all want to mute the
// SDK's startup banner don't race each other into permanently installing the
// no-op writer (which would silently freeze Ink's dashboard renderer).
const realStdoutWrite = process.stdout.write.bind(process.stdout);
let stdoutSuppressionCount = 0;

function suppressStdout(): void {
  stdoutSuppressionCount++;
  if (stdoutSuppressionCount === 1) {
    (process.stdout as unknown as { write: () => boolean }).write = () => true;
  }
}

function restoreStdout(): void {
  if (stdoutSuppressionCount === 0) return;
  stdoutSuppressionCount--;
  if (stdoutSuppressionCount === 0) {
    (process.stdout as unknown as { write: typeof realStdoutWrite }).write =
      realStdoutWrite;
  }
}

export interface CommandResult {
  name: string;
  prompt: string;
  response: string;
  toolEvents: SessionEvent[];
  durationMs: number;
  status: 'success' | 'failed';
  error?: string;
}

export async function runCommand(opts: {
  model: string;
  cwd: string;
  prompt: string;
  name: string;
  timeoutMs: number;
  token?: string;
}): Promise<CommandResult> {
  const { model, cwd, prompt, name, timeoutMs, token } = opts;
  const startedAt = Date.now();

  const clientEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(token ? { GITHUB_TOKEN: token } : {}),
    // Suppress Node.js experimental-feature warnings (e.g. SQLite) emitted by
    // the Copilot CLI subprocess. Those warnings bypass Ink's patchConsole and
    // corrupt cursor tracking on the shared TTY.
    NODE_NO_WARNINGS: '1',
  };

  // Suppress SDK startup banner — CopilotClient (and createSession) write directly
  // to process.stdout, bypassing Ink's patchConsole. Suppression is reference
  // counted at module scope so concurrent scans don't race on stdout.write.
  suppressStdout();
  let stdoutRestored = false;
  const safeRestoreStdout = (): void => {
    if (stdoutRestored) return;
    stdoutRestored = true;
    restoreStdout();
  };
  const client = new CopilotClient({ cwd, env: clientEnv });

  try {
    const session = await client.createSession({
      onPermissionRequest: approveAll,
      model,
      streaming: true,
      // Scope tool operations (read/write/edit) to the cloned repo so file-writing
      // prompts (e.g., "save to .sss/architecture.md") actually persist on disk
      // rather than being returned as the assistant's text response.
      workingDirectory: cwd,
    });

    // Flush any async-queued banner writes from the SDK before restoring stdout.
    await new Promise<void>((resolve) => setImmediate(resolve));
    safeRestoreStdout();

    const toolEvents: SessionEvent[] = [];
    let finalContent = '';

    session.on((event: SessionEvent) => {
      if (
        event.type === 'tool.execution_start' ||
        event.type === 'tool.execution_complete' ||
        event.type === 'tool.execution_partial_result' ||
        event.type === 'tool.execution_progress'
      ) {
        toolEvents.push(event);
      }
    });

    const response = await session.sendAndWait({ prompt }, timeoutMs);

    if (response?.data?.content) {
      finalContent = response.data.content;
    }

    return {
      name,
      prompt,
      response: finalContent,
      toolEvents,
      durationMs: Date.now() - startedAt,
      status: 'success',
    };
  } catch (err) {
    // Always restore stdout in case createSession threw before we could restore it.
    safeRestoreStdout();
    return {
      name,
      prompt,
      response: '',
      toolEvents: [],
      durationMs: Date.now() - startedAt,
      status: 'failed',
      error: String(err),
    };
  } finally {
    await client.stop();
  }
}

