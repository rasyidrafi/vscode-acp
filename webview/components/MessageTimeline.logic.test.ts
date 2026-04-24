import { describe, expect, it } from 'vitest';

import type { ChatItem } from '../../src/shared/chatModel';
import { deriveTimelineRows } from './MessageTimeline.logic';

describe('deriveTimelineRows', () => {
  it('renders thoughts and tool calls as sealed timeline rows', () => {
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
      'thought',
      'tool',
      'tool',
    ]);
    expect(rows[1]).toMatchObject({
      kind: 'message',
      id: 'assistant-1',
    });
    expect(rows[2]).toMatchObject({
      kind: 'thought',
      id: 'thought-1',
    });
  });

  it('marks the first non-user item after a user prompt as the response start', () => {
    const rows = deriveTimelineRows([
      userMessage('user-1'),
    ], [
      thought('thought-1'),
      toolCall('tool-1'),
      toolCall('tool-2'),
    ]);

    expect(rows[1]).toMatchObject({
      kind: 'thought',
      showResponseDivider: true,
    });
    expect(rows[2]).toMatchObject({
      kind: 'tool',
      showResponseDivider: false,
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
    expect(secondRows[3]).toBe(firstRows[3]);
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

  it('only shows assistant meta for the absolute last message when turn is finished', () => {
    const user = userMessage('user-1');
    const assistant = { ...assistantMessage('assistant-1'), order: 2 };
    const t = { ...thought('thought-1'), order: 3 };

    // Assistant message followed by thought - should NOT show meta
    const rowsWithThought = deriveTimelineRows([user, assistant], [t], { turnInProgress: false });
    expect(rowsWithThought.find(r => r.id === 'assistant-1')).toMatchObject({
      showAssistantMeta: false
    });

    // Assistant message is last but turn in progress - should NOT show meta
    const rowsInProgress = deriveTimelineRows([user, assistant], [], { turnInProgress: true });
    expect(rowsInProgress.find(r => r.id === 'assistant-1')).toMatchObject({
      showAssistantMeta: false
    });

    // Assistant message is last and turn NOT in progress - SHOULD show meta
    const rowsFinished = deriveTimelineRows([user, assistant], [], { turnInProgress: false });
    expect(rowsFinished.find(r => r.id === 'assistant-1')).toMatchObject({
      showAssistantMeta: true
    });
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
