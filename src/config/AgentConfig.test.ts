import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(() => ({})),
    })),
  },
}));

vi.mock('../utils/Logger', () => ({
  logError: vi.fn(),
}));

import { createAgentConfigFromRegistry, sanitizeAgentConfigs } from './AgentConfig';

describe('sanitizeAgentConfigs', () => {
  it('drops invalid agent entries and keeps normalized valid ones', () => {
    const agents = sanitizeAgentConfigs({
      Valid: {
        command: ' npx ',
        args: [' --acp ', 42, ''],
        env: { FOO: 'bar', BAD: 123 },
      },
      BinaryOnly: {
        binaryName: 'gemini',
        binaryArgs: [' --acp '],
      },
      Invalid: {
        args: ['missing-command'],
      },
    });

    expect(agents).toEqual({
      Valid: {
        command: 'npx',
        args: ['--acp'],
        env: { FOO: 'bar' },
      },
      BinaryOnly: {
        command: '',
        binaryName: 'gemini',
        binaryArgs: ['--acp'],
      },
    });
  });
});

describe('createAgentConfigFromRegistry', () => {
  it('builds npx launch config keyed by registry metadata', () => {
    expect(createAgentConfigFromRegistry({
      id: 'codex-acp',
      name: 'Codex CLI',
      version: '0.12.0',
      distribution: {
        npx: {
          package: '@zed-industries/codex-acp@0.12.0',
          args: ['--flag'],
          env: { FOO: 'bar' },
        },
      },
    })).toEqual({
      id: 'codex-acp',
      displayName: 'Codex CLI',
      registryVersion: '0.12.0',
      command: 'npx',
      args: ['@zed-industries/codex-acp@0.12.0', '--flag'],
      env: { FOO: 'bar' },
    });
  });

  it('prefers local CLI launch for supported installed agents with registry fallback', () => {
    expect(createAgentConfigFromRegistry({
      id: 'gemini',
      name: 'Gemini CLI',
      distribution: {
        npx: {
          package: '@google/gemini-cli@0.39.1',
          args: ['--acp'],
        },
      },
    })).toEqual({
      id: 'gemini',
      displayName: 'Gemini CLI',
      command: 'npx',
      args: ['@google/gemini-cli@0.39.1', '--acp'],
      binaryName: 'gemini',
      binaryArgs: ['--acp'],
      binaryPath: '',
    });
  });

  it('rejects registry entries without a supported launch method', () => {
    expect(createAgentConfigFromRegistry({
      id: 'binary-only',
      name: 'Binary Only',
      distribution: {
        binary: {
          'linux-x86_64': { cmd: './binary-only' },
        },
      },
    })).toBeNull();
  });
});
