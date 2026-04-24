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
    expect(state.messages).toEqual([
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

    expect(second.messages).toHaveLength(1);
    expect(second.messages[0]).toMatchObject({
      kind: 'message',
      role: 'assistant',
      text: 'Hello there',
      streaming: true,
    });
  });

  it('splits assistant messages when tool activity appears between chunks', () => {
    const base = withSession();
    const first = reduceWebviewState(base, sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'First response' },
    }));
    const withTool = reduceWebviewState(first, sessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'cmd-1',
      title: 'Terminal',
      status: 'completed',
      rawInput: {
        command: ['pwd'],
      },
    }));
    const second = reduceWebviewState(withTool, sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Second response' },
    }));

    expect(second.messages).toHaveLength(2);
    expect(second.messages[0]).toMatchObject({
      text: 'First response',
      streaming: false,
    });
    expect(second.messages[1]).toMatchObject({
      text: 'Second response',
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
    expect(done.activities[0]).toMatchObject({
      kind: 'thought',
      text: 'Inspecting files',
      streaming: false,
      collapsed: true,
    });
  });

  it('splits thought segments when assistant text resumes', () => {
    const base = withSession();
    const thinking = reduceWebviewState(base, sessionUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'Inspecting files' },
    }));
    const withMessage = reduceWebviewState(thinking, sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Found it' },
    }));
    const thinkingAgain = reduceWebviewState(withMessage, sessionUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'Double-checking' },
    }));

    expect(thinkingAgain.activities).toHaveLength(2);
    expect(thinkingAgain.activities[0]).toMatchObject({
      kind: 'thought',
      text: 'Inspecting files',
      streaming: false,
      collapsed: true,
    });
    expect(thinkingAgain.activities[1]).toMatchObject({
      kind: 'thought',
      text: 'Double-checking',
      streaming: true,
      collapsed: false,
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

    expect(updated.activities).toHaveLength(1);
    expect(updated.activities[0]).toMatchObject({
      kind: 'toolCall',
      id: 'tool-read-1',
      title: 'Read file',
      status: 'running',
      detail: 'Reading src/index.ts',
    });
  });

  it('derives semantic command activity summaries', () => {
    const state = reduceWebviewState(withSession(), sessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'cmd-1',
      title: 'Terminal',
      status: 'completed',
      rawInput: {
        command: ['npm', 'run', 'typecheck'],
      },
      rawOutput: 'All good',
    }));

    expect(state.activities[0]).toMatchObject({
      kind: 'toolCall',
      id: 'tool-cmd-1',
      title: 'Ran command',
      detail: 'npm run typecheck',
      status: 'completed',
    });
  });

  it('derives semantic file change activity summaries', () => {
    const state = reduceWebviewState(withSession(), sessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'write-2',
      title: 'Write file',
      status: 'completed',
      rawInput: {
        path: 'src/core/AgentManager.ts',
      },
      rawOutput: 'updated file',
    }));

    expect(state.activities[0]).toMatchObject({
      kind: 'toolCall',
      id: 'tool-write-2',
      title: 'Changed files',
      detail: 'src/core/AgentManager.ts',
      status: 'completed',
    });
  });

  it('normalizes tool call detail from ACP content arrays', () => {
    const state = reduceWebviewState(withSession(), sessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'write-1',
      title: 'Write file',
      status: 'failed',
      content: [
        { type: 'text', text: 'top-level text' },
        { type: 'content', content: { type: 'text', text: 'nested text' } },
        { type: 'content', content: { type: 'image', data: 'ignored' } },
      ],
    }));

    expect(state.activities[0]).toMatchObject({
      kind: 'toolCall',
      id: 'tool-write-1',
      title: 'Changed files',
      status: 'failed',
      detail: 'top-level text',
    });
  });

  it('stores the current plan outside the transcript', () => {
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

    expect(first.activePlan?.entries).toEqual([
      { id: 'plan-0', text: 'Read plan', status: 'completed' },
      { id: 'plan-1', text: 'Implement reducer', status: 'inProgress' },
    ]);
    expect(second.messages).toHaveLength(0);
    expect(second.activities).toHaveLength(0);
    expect(second.activePlan).toMatchObject({
      entries: [{ id: 'plan-0', text: 'Verify tests', status: 'pending' }],
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

  it('tracks attached files and clears them after use', () => {
    const attached = reduceWebviewState(withSession(), extensionMessage({
      type: 'fileAttached',
      file: { path: '/workspace/src/app.ts', name: 'app.ts' },
    }));
    const duplicate = reduceWebviewState(attached, extensionMessage({
      type: 'fileAttached',
      file: { path: '/workspace/src/app.ts', name: 'app.ts' },
    }));
    const removed = reduceWebviewState(duplicate, {
      type: 'removeAttachment',
      path: '/workspace/src/app.ts',
    });
    const consumed = reduceWebviewState(attached, { type: 'attachmentsConsumed' });

    expect(duplicate.attachedFiles).toEqual([{ path: '/workspace/src/app.ts', name: 'app.ts' }]);
    expect(removed.attachedFiles).toHaveLength(0);
    expect(consumed.attachedFiles).toHaveLength(0);
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

    expect(state.messages).toHaveLength(0);
    expect(state.activities).toHaveLength(0);
  });

  it('ignores malformed or unsupported ACP updates', () => {
    const base = withSession();
    const malformed = reduceWebviewState(base, sessionUpdate({ content: { type: 'text', text: 'no kind' } }));
    const unsupported = reduceWebviewState(malformed, sessionUpdate({
      sessionUpdate: 'unknown_update',
      content: { type: 'text', text: 'ignore me' },
    }));
    const invalidMode = reduceWebviewState(unsupported, sessionUpdate({
      sessionUpdate: 'current_mode_update',
      currentModeId: 123,
    }));

    expect(invalidMode).toBe(base);
  });

  it('restores persisted state and clears the timeline when the active session changes', () => {
    const withMessage = reduceWebviewState(withSession(), sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'previous' },
    }));
    const persisted = toPersistedState(withMessage);

    expect(isPersistedWebviewState(persisted)).toBe(true);
    expect(createInitialState(persisted).messages).toHaveLength(1);

    const switched = reduceWebviewState(createInitialState(persisted), extensionMessage({
      type: 'state',
      activeSessionId: 'session-2',
      session: sessionState({ sessionId: 'session-2' }),
    }));

    expect(switched.messages).toHaveLength(0);
    expect(switched.activities).toHaveLength(0);
    expect(switched.nextOrder).toBe(1);
    expect(switched.activePlan).toBeNull();
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
