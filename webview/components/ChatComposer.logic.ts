import type { AvailableCommand } from '@agentclientprotocol/sdk';

export interface ComposerSendState {
  canSend: boolean;
  isCancel: boolean;
  buttonLabel: string;
  placeholder: string;
}

export function getComposerSendState(options: {
  hasSession: boolean;
  prompt: string;
  turnInProgress: boolean;
  availableCommandCount: number;
  attachmentCount?: number;
  commandInputHint?: string | null;
}): ComposerSendState {
  if (options.turnInProgress) {
    return {
      canSend: true,
      isCancel: true,
      buttonLabel: 'Cancel',
      placeholder: 'Agent is working',
    };
  }

  return {
    canSend: options.hasSession && (options.prompt.trim().length > 0 || Boolean(options.attachmentCount)),
    isCancel: false,
    buttonLabel: 'Send',
    placeholder: composerPlaceholder(
      options.hasSession,
      options.availableCommandCount,
      options.commandInputHint,
    ),
  };
}

export function getSlashCommandQuery(prompt: string): string | null {
  if (!prompt.startsWith('/')) {
    return null;
  }
  const firstSpace = prompt.indexOf(' ');
  if (firstSpace >= 0) {
    return null;
  }
  return prompt.slice(1);
}

export function commandPrompt(command: AvailableCommand): string {
  return `/${command.name}`;
}

export function commandNeedsInput(command: AvailableCommand): boolean {
  return command.input !== null && command.input !== undefined;
}

export function commandInputHint(command: AvailableCommand): string | null {
  const input = command.input;
  return isRecord(input) && typeof input.hint === 'string' ? input.hint : null;
}

function composerPlaceholder(
  hasSession: boolean,
  availableCommandCount: number,
  commandInputHint?: string | null,
): string {
  if (!hasSession) {
    return 'Connect to an agent';
  }
  if (commandInputHint) {
    return commandInputHint;
  }
  if (availableCommandCount > 0) {
    return 'Ask the agent or type / for commands';
  }
  return 'Ask the agent';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
