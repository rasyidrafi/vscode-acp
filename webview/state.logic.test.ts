import { describe, expect, it } from 'vitest';

import type { BridgeSessionState, ExtensionToWebviewMessage } from '../src/shared/bridge';
import { createInitialState, isPersistedWebviewState, toPersistedState } from './state';
import { reduceWebviewState } from './state.logic';

describe('webview state reducer', () => {
  it('loads session state and available commands from the extension', () => {
    const state = reduceWebviewState(createInitialState(), extensionMessage({
      type: 'state',
      activeSessionId: 'session-1',
      session: sessionState({
        availableCommands: [{ name: 'review', description: 'Review changes' }],
      }),
    }));

    expect(state.activeSessionId).toBe('session-1');
    expect(state.session?.agentName).toBe('Codex');
    expect(state.availableCommands).toHaveLength(1);
  });

  it('adds a local user prompt and marks a turn active', () => {
    const state = reduceWebviewState(createInitialState(), {
      type: 'promptSubmitted',
      text: '  hello agent  ',
    });

    expect(state.turnInProgress).toBe(true);
    expect(state.items).toEqual([
      expect.objectContaining({
        kind: 'message',
        role: 'user',
        text: 'hello agent',
      }),
    ]);
  });

  it('normalizes assistant text chunks into one streaming message', () => {
    const base = withSession();
    const first = reduceWebviewState(base, sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello' },
    }));
    const second = reduceWebviewState(first, sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: ' there' },
    }));

    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({
      kind: 'message',
      role: 'assistant',
      text: 'Hello there',
      streaming: true,
    });
  });

  it('normalizes thought chunks and finalizes streaming on prompt end', () => {
    const thinking = reduceWebviewState(withSession(), sessionUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'Inspecting files' },
    }));
    const done = reduceWebviewState(thinking, extensionMessage({ type: 'promptEnd' }));

    expect(done.turnInProgress).toBe(false);
    expect(done.items[0]).toMatchObject({
      kind: 'thought',
      text: 'Inspecting files',
      streaming: false,
      collapsed: true,
    });
  });

  it('creates and updates tool calls', () => {
    const created = reduceWebviewState(withSession(), sessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'read-1',
      title: 'Read file',
      status: 'pending',
    }));
    const updated = reduceWebviewState(created, sessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'read-1',
      status: 'in_progress',
      rawOutput: 'Reading src/index.ts',
    }));

    expect(updated.items).toHaveLength(1);
    expect(updated.items[0]).toMatchObject({
      kind: 'toolCall',
      id: 'tool-read-1',
      title: 'Read file',
      status: 'running',
      detail: 'Reading src/index.ts',
    });
  });

  it('replaces the current plan with normalized entries', () => {
    const first = reduceWebviewState(withSession(), sessionUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Read plan', status: 'completed' },
        { title: 'Implement reducer', status: 'in_progress' },
      ],
    }));
    const second = reduceWebviewState(first, sessionUpdate({
      sessionUpdate: 'plan',
      entries: [{ description: 'Verify tests', status: 'pending' }],
    }));

    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({
      kind: 'plan',
      entries: [{ id: 'plan-0', text: 'Verify tests', completed: false }],
    });
  });

  it('updates commands and current mode from session updates', () => {
    const base = withSession({
      modes: {
        currentModeId: 'code',
        availableModes: [{ id: 'code', name: 'Code' }, { id: 'plan', name: 'Plan' }],
      } as never,
    });
    const commands = reduceWebviewState(base, sessionUpdate({
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: 'test', description: 'Run tests' }],
    }));
    const mode = reduceWebviewState(commands, sessionUpdate({
      sessionUpdate: 'current_mode_update',
      currentModeId: 'plan',
    }));

    expect(mode.availableCommands).toHaveLength(1);
    expect((mode.modes as { currentModeId: string } | null)?.currentModeId).toBe('plan');
    expect((mode.session?.modes as { currentModeId: string } | null)?.currentModeId).toBe('plan');
  });

  it('ignores updates for inactive sessions', () => {
    const state = reduceWebviewState(withSession(), extensionMessage({
      type: 'sessionUpdate',
      sessionId: 'other-session',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'ignore me' },
      } as never,
    }));

    expect(state.items).toHaveLength(0);
  });

  it('restores persisted state and clears the timeline when the active session changes', () => {
    const withMessage = reduceWebviewState(withSession(), sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'previous' },
    }));
    const persisted = toPersistedState(withMessage);

    expect(isPersistedWebviewState(persisted)).toBe(true);
    expect(createInitialState(persisted).items).toHaveLength(1);

    const switched = reduceWebviewState(createInitialState(persisted), extensionMessage({
      type: 'state',
      activeSessionId: 'session-2',
      session: sessionState({ sessionId: 'session-2' }),
    }));

    expect(switched.items).toHaveLength(0);
    expect(switched.nextItemId).toBe(1);
  });
});

function withSession(overrides: Partial<BridgeSessionState> = {}) {
  return reduceWebviewState(createInitialState(), extensionMessage({
    type: 'state',
    activeSessionId: overrides.sessionId ?? 'session-1',
    session: sessionState(overrides),
  }));
}

function sessionState(overrides: Partial<BridgeSessionState> = {}): BridgeSessionState {
  return {
    sessionId: 'session-1',
    agentName: 'Codex',
    cwd: '/workspace',
    modes: null,
    models: null,
    availableCommands: [],
    ...overrides,
  };
}

function extensionMessage(message: ExtensionToWebviewMessage) {
  return { type: 'extensionMessage' as const, message };
}

function sessionUpdate(update: Record<string, unknown>) {
  return extensionMessage({
    type: 'sessionUpdate',
    sessionId: 'session-1',
    update: update as never,
  });
}
