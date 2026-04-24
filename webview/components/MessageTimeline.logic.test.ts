import { describe, expect, it } from 'vitest';

import type { ChatItem } from '../../src/shared/chatModel';
import { deriveTimelineRows } from './MessageTimeline.logic';

describe('deriveTimelineRows', () => {
  it('groups adjacent thoughts and tool calls into work rows', () => {
    const rows = deriveTimelineRows([
      userMessage('user-1'),
      assistantMessage('assistant-1'),
    ], [
      thought('thought-1'),
      toolCall('tool-1'),
      toolCall('tool-2'),
    ]);

    expect(rows.map((row) => row.kind)).toEqual([
      'message',
      'message',
      'work',
    ]);
    expect(rows[1]).toMatchObject({
      kind: 'message',
      id: 'assistant-1',
    });
    expect(rows[2]).toMatchObject({
      kind: 'work',
      id: 'work-thought-1-tool-2',
    });
  });

  it('preserves row object identity when visible fields did not change', () => {
    const messages = [
      userMessage('user-1'),
      assistantMessage('assistant-1'),
    ];
    const activities = [thought('thought-1'), toolCall('tool-1')];
    const firstRows = deriveTimelineRows(messages, activities);
    const secondRows = deriveTimelineRows([...messages], [...activities], { previousRows: firstRows });

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
      baseAssistant,
    ], [existingThought]);
    const secondRows = deriveTimelineRows([
      user,
      { ...baseAssistant, text: 'Hello there' },
    ], [existingThought], { previousRows: firstRows });

    expect(secondRows[0]).toBe(firstRows[0]);
    expect(secondRows[1]).not.toBe(firstRows[1]);
    expect(secondRows[2]).toBe(firstRows[2]);
  });

  it('adds a working row while waiting for the first streaming update', () => {
    expect(deriveTimelineRows([userMessage('user-1')], [], { turnInProgress: true }))
      .toEqual([
        expect.objectContaining({ kind: 'message', id: 'user-1' }),
        { kind: 'working', id: 'working-current-turn' },
      ]);
  });

  it('does not add a working row when a stream is visible', () => {
    const rows = deriveTimelineRows([
      userMessage('user-1'),
      assistantMessage('assistant-1', 'Streaming', true),
    ], [], { turnInProgress: true });

    expect(rows.map((row) => row.kind)).toEqual(['message', 'message']);
  });
});

function userMessage(id: string): Extract<ChatItem, { kind: 'message' }> {
  return {
    order: 1,
    kind: 'message',
    id,
    role: 'user',
    text: 'Hello',
  };
}

function assistantMessage(id: string, text = 'Hi', streaming = false): Extract<ChatItem, { kind: 'message' }> {
  return {
    order: 2,
    kind: 'message',
    id,
    role: 'assistant',
    text,
    streaming,
  };
}

function thought(id: string): Extract<ChatItem, { kind: 'thought' }> {
  return {
    order: 3,
    kind: 'thought',
    id,
    text: 'Thinking',
  };
}

function toolCall(id: string): Extract<ChatItem, { kind: 'toolCall' }> {
  return {
    order: id === 'tool-2' ? 5 : 4,
    kind: 'toolCall',
    id,
    title: 'Read file',
    status: 'running',
  };
}
