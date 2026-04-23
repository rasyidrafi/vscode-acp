import { describe, expect, it } from 'vitest';

import type { AvailableCommand } from '@agentclientprotocol/sdk';
import {
  commandInputHint,
  commandNeedsInput,
  commandPrompt,
  getComposerSendState,
  getSlashCommandQuery,
} from './ChatComposer.logic';

describe('ChatComposer logic', () => {
  it('allows sending only with a session and non-empty prompt', () => {
    expect(getComposerSendState({
      hasSession: true,
      prompt: '  hello  ',
      turnInProgress: false,
      availableCommandCount: 0,
    })).toMatchObject({ canSend: true, isCancel: false });

    expect(getComposerSendState({
      hasSession: false,
      prompt: 'hello',
      turnInProgress: false,
      availableCommandCount: 0,
    })).toMatchObject({ canSend: false, placeholder: 'Connect to an agent' });
  });

  it('allows sending with attachments even when prompt is empty', () => {
    expect(getComposerSendState({
      hasSession: true,
      prompt: '',
      turnInProgress: false,
      availableCommandCount: 0,
      attachmentCount: 1,
    })).toMatchObject({ canSend: true, isCancel: false });
  });

  it('turns the send button into cancel while a turn is active', () => {
    expect(getComposerSendState({
      hasSession: true,
      prompt: '',
      turnInProgress: true,
      availableCommandCount: 2,
    })).toMatchObject({
      canSend: true,
      isCancel: true,
      buttonLabel: 'Cancel',
    });
  });

  it('extracts slash command query only before command input starts', () => {
    expect(getSlashCommandQuery('/re')).toBe('re');
    expect(getSlashCommandQuery('/review changes')).toBeNull();
    expect(getSlashCommandQuery('please /review')).toBeNull();
  });

  it('formats selected command prompts and input hints', () => {
    const withInput = command('review', {
      hint: 'Describe what to review',
    } as never);

    expect(commandPrompt(withInput)).toBe('/review');
    expect(commandNeedsInput(withInput)).toBe(true);
    expect(commandInputHint(withInput)).toBe('Describe what to review');
    expect(commandNeedsInput(command('status'))).toBe(false);
  });
});

function command(name: string, input: AvailableCommand['input'] = null): AvailableCommand {
  return {
    name,
    description: `${name} command`,
    input,
  };
}
