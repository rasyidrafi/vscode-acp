import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeCommandMock } = vi.hoisted(() => ({
  executeCommandMock: vi.fn(),
}));

vi.mock('vscode', () => ({
  commands: {
    executeCommand: executeCommandMock,
  },
}));

vi.mock('../utils/Logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../utils/TelemetryManager', () => ({
  sendEvent: vi.fn(),
}));

vi.mock('./webviewHtml', () => ({
  getChatWebviewHtml: vi.fn(() => '<html></html>'),
}));

import { ChatWebviewProvider } from './ChatWebviewProvider';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';

describe('ChatWebviewProvider', () => {
  beforeEach(() => {
    executeCommandMock.mockReset();
  });

  it('ignores stale session updates and persists available commands for the active session only', () => {
    const session = {
      sessionId: 'session-1',
      availableCommands: [],
      agentDisplayName: 'Codex',
      cwd: '/workspace',
      modes: null,
      models: null,
    };
    const sessionManager = {
      getActiveSessionId: vi.fn(() => 'session-1'),
      getSession: vi.fn(() => session),
      getActiveAgentName: vi.fn(() => 'Codex'),
      setMode: vi.fn(),
      setModel: vi.fn(),
      sendPrompt: vi.fn(),
      cancelTurn: vi.fn(),
    };
    const updateHandler = new SessionUpdateHandler();
    const provider = new ChatWebviewProvider(
      { fsPath: '/extension' } as never,
      sessionManager as never,
      updateHandler,
    );

    const posted: unknown[] = [];
    (provider as unknown as {
      view?: { webview: { postMessage: (message: unknown) => void } };
    }).view = {
      webview: {
        postMessage: (message: unknown) => {
          posted.push(message);
        },
      },
    };

    updateHandler.handleUpdate({
      sessionId: 'stale-session',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'old', description: 'stale' }],
      },
    } as never);

    updateHandler.handleUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'review', description: 'fresh' }],
      },
    } as never);

    expect(session.availableCommands).toEqual([{ name: 'review', description: 'fresh' }]);
    expect(posted).toEqual([
      {
        type: 'sessionUpdate',
        sessionId: 'stale-session',
        update: {
          sessionUpdate: 'available_commands_update',
          availableCommands: [{ name: 'old', description: 'stale' }],
        },
      },
      {
        type: 'sessionUpdate',
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'available_commands_update',
          availableCommands: [{ name: 'review', description: 'fresh' }],
        },
      },
    ]);
  });

  it('derives chat-content state from synced session data', async () => {
    const sessionManager = {
      getActiveSessionId: vi.fn(() => 'session-1'),
      getSession: vi.fn(),
      getActiveAgentName: vi.fn(() => 'Codex'),
      setMode: vi.fn(),
      setModel: vi.fn(),
      sendPrompt: vi.fn(),
      cancelTurn: vi.fn(),
    };
    const provider = new ChatWebviewProvider(
      { fsPath: '/extension' } as never,
      sessionManager as never,
      new SessionUpdateHandler(),
    );
    const internals = provider as unknown as {
      handleWebviewMessage: (message: { type: 'stateSync'; activeSessionId: string | null; hasChatContent: boolean }) => Promise<void>;
    };

    await internals.handleWebviewMessage({
      type: 'stateSync',
      activeSessionId: 'other-session',
      hasChatContent: true,
    });
    expect(provider.hasChatContent).toBe(false);

    await internals.handleWebviewMessage({
      type: 'stateSync',
      activeSessionId: 'session-1',
      hasChatContent: true,
    });
    expect(provider.hasChatContent).toBe(true);
  });
});
