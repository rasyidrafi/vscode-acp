import { describe, expect, it } from 'vitest';

import { parseCommandArgs } from './commandArgs';

describe('parseCommandArgs', () => {
  it('splits plain whitespace-delimited arguments', () => {
    expect(parseCommandArgs('-y @my-org/agent --acp')).toEqual(['-y', '@my-org/agent', '--acp']);
  });

  it('preserves quoted segments with spaces', () => {
    expect(parseCommandArgs('--prompt "hello world" \'two words\'')).toEqual([
      '--prompt',
      'hello world',
      'two words',
    ]);
  });

  it('handles escaped characters outside and inside quotes', () => {
    expect(parseCommandArgs('cmd path\\ with\\ spaces "say \\"hi\\""')).toEqual([
      'cmd',
      'path with spaces',
      'say "hi"',
    ]);
  });
});
