import { CopilotClient, approveAll } from '@github/copilot-sdk';
import type { SessionEvent } from '@github/copilot-sdk';

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
  };

  // cwd is set on the CopilotClient, not on the session
  const client = new CopilotClient({ cwd, env: clientEnv });

  try {
    const session = await client.createSession({
      onPermissionRequest: approveAll,
      model,
      streaming: true,
    });

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


