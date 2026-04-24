import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock, existsSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  existsSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}));

import {
  getWindowsCandidateNames,
  resolveCommandFromPath,
  shouldUseShellForCommand,
  spawnCommand,
} from './processLaunch';

describe('processLaunch', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    existsSyncMock.mockReset();
  });

  it('adds PATHEXT variants for Windows commands', () => {
    expect(getWindowsCandidateNames('npx', '.EXE;.CMD')).toEqual([
      'npx',
      'npx.exe',
      'npx.cmd',
    ]);
  });

  it('resolves commands from PATH entries', () => {
    existsSyncMock.mockImplementation((candidate: string) => candidate === '/usr/bin/node');

    expect(resolveCommandFromPath('node', 'linux', '/bin:/usr/bin')).toBe('/usr/bin/node');
  });

  it('uses direct spawn by default', () => {
    spawnCommand('node', ['--version'], { cwd: '/workspace' });

    expect(spawnMock).toHaveBeenCalledWith('node', ['--version'], {
      cwd: '/workspace',
      shell: false,
    });
  });

  it('uses a shell only for Windows batch commands', () => {
    expect(shouldUseShellForCommand('npx.cmd', 'win32')).toBe(true);
    expect(shouldUseShellForCommand('node.exe', 'win32')).toBe(false);
    expect(shouldUseShellForCommand('/usr/bin/node', 'linux')).toBe(false);
  });
});
