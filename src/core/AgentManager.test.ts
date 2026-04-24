import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  spawnCommandMock,
  resolveCommandFromPathMock,
  shouldUseShellForCommandMock,
} = vi.hoisted(() => ({
  spawnCommandMock: vi.fn(),
  resolveCommandFromPathMock: vi.fn(),
  shouldUseShellForCommandMock: vi.fn(),
}));

vi.mock('../utils/Logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../utils/TelemetryManager', () => ({
  sendEvent: vi.fn(),
  sendError: vi.fn(),
}));

vi.mock('../utils/processLaunch', () => ({
  resolveCommandFromPath: resolveCommandFromPathMock,
  shouldUseShellForCommand: shouldUseShellForCommandMock,
  spawnCommand: spawnCommandMock,
}));

import { AgentManager } from './AgentManager';

function createChildProcessMock(): EventEmitter & {
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  exitCode: number | null;
} {
  const process = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    exitCode: number | null;
  };
  process.stderr = new EventEmitter();
  process.kill = vi.fn();
  process.exitCode = null;
  return process;
}

describe('AgentManager', () => {
  beforeEach(() => {
    spawnCommandMock.mockReset();
    resolveCommandFromPathMock.mockReset();
    shouldUseShellForCommandMock.mockReset();
    shouldUseShellForCommandMock.mockReturnValue(false);
  });

  it('resolves fallback commands before spawning', () => {
    const child = createChildProcessMock();
    spawnCommandMock.mockReturnValue(child);
    resolveCommandFromPathMock.mockImplementation((command: string) => (
      command === 'npx' ? '/usr/bin/npx' : undefined
    ));

    const manager = new AgentManager();
    const instance = manager.spawnAgent('Codex', {
      command: 'npx',
      args: ['@zed-industries/codex-acp@latest'],
      env: { FOO: 'bar' },
    }, '/workspace');

    expect(instance.id).toBe('agent_1');
    expect(spawnCommandMock).toHaveBeenCalledWith('/usr/bin/npx', ['@zed-industries/codex-acp@latest'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: expect.objectContaining({ FOO: 'bar' }),
      cwd: '/workspace',
    });
  });
});
