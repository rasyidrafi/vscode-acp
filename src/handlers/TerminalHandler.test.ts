import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createTerminalMock,
  MockVsCodeEventEmitter,
  resolveCommandFromPathMock,
  spawnCommandMock,
} = vi.hoisted(() => ({
  createTerminalMock: vi.fn(),
  MockVsCodeEventEmitter: class {
    public readonly event = vi.fn();
    public readonly fire = vi.fn();
    public readonly dispose = vi.fn();
  },
  resolveCommandFromPathMock: vi.fn(),
  spawnCommandMock: vi.fn(),
}));

vi.mock('vscode', () => ({
  EventEmitter: MockVsCodeEventEmitter,
  window: {
    createTerminal: createTerminalMock,
  },
}));

vi.mock('../utils/Logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../utils/processLaunch', () => ({
  resolveCommandFromPath: resolveCommandFromPathMock,
  spawnCommand: spawnCommandMock,
}));

import { TerminalHandler } from './TerminalHandler';

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe('TerminalHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createTerminalMock.mockReset();
    resolveCommandFromPathMock.mockReset();
    spawnCommandMock.mockReset();
    createTerminalMock.mockReturnValue({ dispose: vi.fn() });
  });

  it('captures output and reports exit status', async () => {
    const child = createChildProcess();
    spawnCommandMock.mockReturnValue(child);
    resolveCommandFromPathMock.mockReturnValue('/usr/bin/npm');

    const handler = new TerminalHandler();
    const created = await handler.createTerminal({
      sessionId: 'session-1',
      command: 'npm',
      args: ['run', 'typecheck'],
    });

    child.stdout.emit('data', Buffer.from('hello\n'));
    vi.advanceTimersByTime(150);
    child.emit('close', 0, null);
    await vi.runAllTimersAsync();

    const output = await handler.terminalOutput({
      sessionId: 'session-1',
      terminalId: created.terminalId,
    });

    expect(spawnCommandMock).toHaveBeenCalledWith('/usr/bin/npm', ['run', 'typecheck'], expect.any(Object));
    expect(output).toMatchObject({
      output: 'hello\n',
      truncated: false,
      exitStatus: {
        exitCode: 0,
        signal: null,
      },
    });
  });

  it('kills running terminals on release and dispose', async () => {
    const first = createChildProcess();
    const second = createChildProcess();
    const firstTerminal = { dispose: vi.fn() };
    const secondTerminal = { dispose: vi.fn() };

    spawnCommandMock
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    createTerminalMock
      .mockReturnValueOnce(firstTerminal)
      .mockReturnValueOnce(secondTerminal);

    const handler = new TerminalHandler();
    const released = await handler.createTerminal({
      sessionId: 'session-1',
      command: 'node',
    });
    await handler.createTerminal({
      sessionId: 'session-1',
      command: 'npm',
    });

    await handler.releaseTerminal({
      sessionId: 'session-1',
      terminalId: released.terminalId,
    });
    handler.dispose();

    expect(first.kill).toHaveBeenCalledWith('SIGTERM');
    expect(second.kill).toHaveBeenCalledWith('SIGKILL');
    expect(firstTerminal.dispose).not.toHaveBeenCalled();
    expect(secondTerminal.dispose).toHaveBeenCalled();
  });
});
