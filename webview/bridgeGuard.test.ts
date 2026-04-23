import { describe, expect, it } from 'vitest';

import { isWebviewToExtensionMessage } from '../src/shared/bridge';

describe('webview bridge guards', () => {
  it('accepts valid webview-to-extension messages', () => {
    expect(isWebviewToExtensionMessage({ type: 'ready' })).toBe(true);
    expect(isWebviewToExtensionMessage({ type: 'sendPrompt', text: 'hello' })).toBe(true);
    expect(isWebviewToExtensionMessage({ type: 'cancelTurn' })).toBe(true);
    expect(isWebviewToExtensionMessage({ type: 'setMode', modeId: 'code' })).toBe(true);
    expect(isWebviewToExtensionMessage({ type: 'setModel', modelId: 'fast' })).toBe(true);
    expect(isWebviewToExtensionMessage({ type: 'executeCommand', command: 'acp.connectAgent' })).toBe(true);
    expect(isWebviewToExtensionMessage({ type: 'clearError' })).toBe(true);
  });

  it('rejects unknown message types and non-object values', () => {
    expect(isWebviewToExtensionMessage(null)).toBe(false);
    expect(isWebviewToExtensionMessage('ready')).toBe(false);
    expect(isWebviewToExtensionMessage({})).toBe(false);
    expect(isWebviewToExtensionMessage({ type: 'unknown' })).toBe(false);
  });

  it('rejects messages with missing or invalid required fields', () => {
    expect(isWebviewToExtensionMessage({ type: 'sendPrompt' })).toBe(false);
    expect(isWebviewToExtensionMessage({ type: 'sendPrompt', text: 123 })).toBe(false);
    expect(isWebviewToExtensionMessage({ type: 'setMode', modeId: null })).toBe(false);
    expect(isWebviewToExtensionMessage({ type: 'setModel', modelId: 42 })).toBe(false);
    expect(isWebviewToExtensionMessage({ type: 'executeCommand', command: false })).toBe(false);
  });
});
