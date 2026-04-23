import { describe, expect, it } from 'vitest';

import type { BridgeSessionState } from '../../src/shared/bridge';
import { getSessionBannerView } from './SessionBanner.logic';

describe('SessionBanner logic', () => {
  it('shows disconnected copy without controls when there is no session', () => {
    expect(getSessionBannerView(null, null, null)).toEqual({
      connected: false,
      agentName: 'No active agent',
      cwd: 'Connect to an agent to start chatting.',
      mode: null,
      model: null,
    });
  });

  it('normalizes mode options and active label', () => {
    const view = getSessionBannerView(session(), {
      currentModeId: 'code',
      availableModes: [
        { id: 'ask', name: 'Ask', description: 'Answer questions' },
        { id: 'code', name: 'Code' },
      ],
    }, null);

    expect(view.connected).toBe(true);
    expect(view.mode).toEqual({
      currentId: 'code',
      currentLabel: 'Code',
      options: [
        { id: 'ask', label: 'Ask', description: 'Answer questions' },
        { id: 'code', label: 'Code' },
      ],
    });
  });

  it('normalizes model options and active label', () => {
    const view = getSessionBannerView(session(), null, {
      currentModelId: 'fast',
      availableModels: [
        { modelId: 'fast', name: 'Fast', description: 'Low latency' },
        { modelId: 'deep', name: 'Deep' },
      ],
    });

    expect(view.model).toEqual({
      currentId: 'fast',
      currentLabel: 'Fast',
      options: [
        { id: 'fast', label: 'Fast', description: 'Low latency' },
        { id: 'deep', label: 'Deep' },
      ],
    });
  });

  it('hides empty mode and model selectors', () => {
    const view = getSessionBannerView(session(), {
      currentModeId: 'code',
      availableModes: [],
    }, {
      currentModelId: 'fast',
      availableModels: [],
    });

    expect(view.mode).toBeNull();
    expect(view.model).toBeNull();
  });
});

function session(): BridgeSessionState {
  return {
    sessionId: 'session-1',
    agentName: 'Codex',
    cwd: '/workspace',
    modes: null,
    models: null,
    availableCommands: [],
  };
}
