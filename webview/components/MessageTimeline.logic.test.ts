import { describe, expect, it } from 'vitest';

import type { ChatItem } from '../../src/shared/chatModel';
import { deriveTimelineRows } from './MessageTimeline.logic';

describe('deriveTimelineRows', () => {
  it('groups adjacent thoughts and tool calls into work rows', () => {
    const rows = deriveTimelineRows([
      userMessage('user-1'),
      thought('thought-1'),
      toolCall('tool-1'),
      assistantMessage('assistant-1'),
      toolCall('tool-2'),
      plan('plan-1'),
    ]);

    expect(rows.map((row) => row.kind)).toEqual([
      'message',
      'work',
      'message',
      'work',
      'plan',
    ]);
    expect(rows[1]).toMatchObject({
      kind: 'work',
      id: 'work-thought-1-tool-1',
    });
    expect(rows[3]).toMatchObject({
      kind: 'work',
      id: 'work-tool-2',
    });
  });

  it('preserves row object identity when visible fields did not change', () => {
    const items = [
      userMessage('user-1'),
      thought('thought-1'),
      toolCall('tool-1'),
      assistantMessage('assistant-1'),
    ];
    const firstRows = deriveTimelineRows(items);
    const secondRows = deriveTimelineRows([...items], { previousRows: firstRows });

    expect(secondRows[0]).toBe(firstRows[0]);
    expect(secondRows[1]).toBe(firstRows[1]);
    expect(secondRows[2]).toBe(firstRows[2]);
  });

  it('replaces only the changed streaming row', () => {
    const user = userMessage('user-1');
    const existingThought = thought('thought-1');
    const baseAssistant = assistantMessage('assistant-1', 'Hello', true);
    const firstRows = deriveTimelineRows([
      user,
      existingThought,
      baseAssistant,
    ]);
    const secondRows = deriveTimelineRows([
      user,
      existingThought,
      { ...baseAssistant, text: 'Hello there' },
    ], { previousRows: firstRows });

    expect(secondRows[0]).toBe(firstRows[0]);
    expect(secondRows[1]).toBe(firstRows[1]);
    expect(secondRows[2]).not.toBe(firstRows[2]);
  });

  it('adds a working row while waiting for the first streaming update', () => {
    expect(deriveTimelineRows([userMessage('user-1')], { turnInProgress: true }))
      .toEqual([
        expect.objectContaining({ kind: 'message', id: 'user-1' }),
        { kind: 'working', id: 'working-current-turn' },
      ]);
  });

  it('does not add a working row when a stream is visible', () => {
    const rows = deriveTimelineRows([
      userMessage('user-1'),
      assistantMessage('assistant-1', 'Streaming', true),
    ], { turnInProgress: true });

    expect(rows.map((row) => row.kind)).toEqual(['message', 'message']);
  });
});

function userMessage(id: string): Extract<ChatItem, { kind: 'message' }> {
  return {
    kind: 'message',
    id,
    role: 'user',
    text: 'Hello',
  };
}

function assistantMessage(id: string, text = 'Hi', streaming = false): Extract<ChatItem, { kind: 'message' }> {
  return {
    kind: 'message',
    id,
    role: 'assistant',
    text,
    streaming,
  };
}

function thought(id: string): Extract<ChatItem, { kind: 'thought' }> {
  return {
    kind: 'thought',
    id,
    text: 'Thinking',
  };
}

function toolCall(id: string): Extract<ChatItem, { kind: 'toolCall' }> {
  return {
    kind: 'toolCall',
    id,
    title: 'Read file',
    status: 'running',
  };
}

function plan(id: string): Extract<ChatItem, { kind: 'plan' }> {
  return {
    kind: 'plan',
    id,
    entries: [{ id: 'entry-1', text: 'Check tests' }],
  };
}
