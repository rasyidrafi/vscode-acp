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

import { sanitizeAgentConfigs } from './AgentConfig';

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
