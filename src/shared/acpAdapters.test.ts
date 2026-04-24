import { describe, expect, it } from 'vitest';

import { adaptSessionUpdate, getSessionModels } from './acpAdapters';

describe('acpAdapters', () => {
  it('normalizes supported session updates', () => {
    const update = adaptSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'cmd-1',
      status: 'completed',
    });

    expect(update).toMatchObject({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'cmd-1',
      status: 'completed',
    });
  });

  it('maps invalid or unsupported updates to the unsupported variant', () => {
    const malformed = adaptSessionUpdate({
      sessionUpdate: 'current_mode_update',
      currentModeId: 123,
    });
    const unsupported = adaptSessionUpdate({
      sessionUpdate: 'usage_update',
      used: 1,
      size: 2,
    });

    expect(malformed).toMatchObject({
      sessionUpdate: 'unsupported',
      originalType: 'current_mode_update',
    });
    expect(unsupported).toMatchObject({
      sessionUpdate: 'unsupported',
      originalType: 'usage_update',
    });
  });

  it('extracts valid model state from new session responses', () => {
    const models = getSessionModels({
      sessionId: 'session-1',
      models: {
        currentModelId: 'gpt-5',
        availableModels: [{ id: 'gpt-5', name: 'GPT-5' }],
      },
    } as never);

    const missing = getSessionModels({
      sessionId: 'session-2',
      models: {
        currentModelId: 123,
        availableModels: [],
      },
    } as never);

    expect(models).toMatchObject({
      currentModelId: 'gpt-5',
      availableModels: [{ id: 'gpt-5', name: 'GPT-5' }],
    });
    expect(missing).toBeNull();
  });
});
