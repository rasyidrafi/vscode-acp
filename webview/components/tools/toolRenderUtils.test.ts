import { describe, expect, it } from 'vitest';

import type { ToolCallActivity } from '../../../src/shared/chatModel';
import { diffWords, inferToolRenderer, parseMaybeJson } from './toolRenderUtils';

describe('toolRenderUtils', () => {
  it('parses JSON payloads for tool inputs', () => {
    const value = parseMaybeJson('{"command":"npm test"}');
    expect(value).toEqual({ command: 'npm test' });
  });

  it('infers bash renderer from semantic title', () => {
    expect(inferToolRenderer(toolCall('Ran command'), undefined)).toBe('bash');
  });

  it('infers search renderer from search-like input', () => {
    expect(inferToolRenderer(toolCall('Tool Call'), { pattern: 'SessionManager' })).toBe('search');
  });

  it('prioritizes explicit toolKind from activity', () => {
    const activity = { ...toolCall('Generic Title'), toolKind: 'read' };
    expect(inferToolRenderer(activity, {})).toBe('read');
  });

  it('infers read renderer from read-like title', () => {
    expect(inferToolRenderer(toolCall('Read file'), undefined)).toBe('read');
    expect(inferToolRenderer(toolCall('Viewing source'), undefined)).toBe('read');
  });

  it('highlights changed words while preserving common text', () => {
    const { oldParts, newParts } = diffWords('const value = one;', 'const value = two;');
    expect(oldParts.some((part) => part.changed && part.text.includes('one;'))).toBe(true);
    expect(newParts.some((part) => part.changed && part.text.includes('two;'))).toBe(true);
    expect(newParts.some((part) => !part.changed && part.text.includes('const value = '))).toBe(true);
  });
});

function toolCall(title: string): ToolCallActivity {
  return {
    kind: 'toolCall',
    id: 'tool-1',
    order: 1,
    title,
    status: 'completed',
  };
}
