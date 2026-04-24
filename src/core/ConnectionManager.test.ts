import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(() => true),
    })),
  },
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      dispose: vi.fn(),
    })),
  },
}));

import { ConnectionManager } from './ConnectionManager';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';

vi.mock('../utils/Logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logTraffic: vi.fn(),
}));

vi.mock('../utils/TelemetryManager', () => ({
  sendEvent: vi.fn(),
  sendError: vi.fn(),
  initTelemetry: vi.fn(),
}));

describe('ConnectionManager', () => {
  it('disposes a connection only once', () => {
    const manager = new ConnectionManager(new SessionUpdateHandler());
    const dispose = vi.fn();
    const info = {
      connection: {} as never,
      client: {} as never,
      initResponse: {} as never,
      dispose,
    };

    (manager as unknown as {
      connections: Map<string, typeof info>;
    }).connections.set('agent_1', info);

    manager.disposeConnection('agent_1');
    manager.disposeConnection('agent_1');

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(manager.getConnection('agent_1')).toBeUndefined();
  });

  it('ignores stale connection records when a different instance is active', () => {
    const manager = new ConnectionManager(new SessionUpdateHandler());
    const activeDispose = vi.fn();
    const staleDispose = vi.fn();
    const activeInfo = {
      connection: {} as never,
      client: {} as never,
      initResponse: {} as never,
      dispose: activeDispose,
    };
    const staleInfo = {
      connection: {} as never,
      client: {} as never,
      initResponse: {} as never,
      dispose: staleDispose,
    };

    (manager as unknown as {
      connections: Map<string, typeof activeInfo>;
    }).connections.set('agent_1', activeInfo);

    manager.disposeConnection('agent_1', staleInfo);

    expect(staleDispose).not.toHaveBeenCalled();
    expect(activeDispose).not.toHaveBeenCalled();
    expect(manager.getConnection('agent_1')).toBe(activeInfo);
  });
});
