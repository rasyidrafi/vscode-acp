import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/Logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

import { clearRegistryCache, fetchRegistry } from './RegistryClient';

describe('RegistryClient', () => {
  beforeEach(() => {
    clearRegistryCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns fresh network results when fetch succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        agents: [{ id: 'codex-acp', name: 'Codex', command: 'npx' }],
      }),
    })));

    const result = await fetchRegistry();

    expect(result).toEqual({
      agents: [{ id: 'codex-acp', name: 'Codex', command: 'npx' }],
      source: 'network',
      status: 'fresh',
    });
  });

  it('returns stale cache data when refresh fails after a successful fetch', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(6 * 60 * 1000);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          agents: [{ id: 'codex-acp', name: 'Codex', command: 'npx' }],
        }),
      })
      .mockRejectedValueOnce(new Error('network down')));

    await fetchRegistry();
    const result = await fetchRegistry();

    expect(result).toMatchObject({
      agents: [{ id: 'codex-acp', name: 'Codex', command: 'npx' }],
      source: 'cache',
      status: 'stale',
      errorMessage: 'network down',
    });
  });

  it('returns failure when no cache is available and fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    const result = await fetchRegistry();

    expect(result).toEqual({
      agents: [],
      source: 'none',
      status: 'failure',
      errorMessage: 'network down',
    });
  });
});
