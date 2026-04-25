import type { AvailableCommand, SessionModeState } from '@agentclientprotocol/sdk';
import { isRecord } from '../lib/typeGuards';

interface LocalCommandMeta {
  kind: 'set-mode';
  modeId: string;
}

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

export function createBuiltInCommands(modes: SessionModeState | null): AvailableCommand[] {
  if (!modes || !Array.isArray(modes.availableModes) || modes.availableModes.length === 0) {
    return [];
  }

  const commands: AvailableCommand[] = [];
  const planMode = findMode(modes, /plan/i);
  const defaultMode = findMode(modes, /^(default|code|auto)$/i)
    ?? findMode(modes, /(default|code|auto|build)/i);

  if (planMode) {
    commands.push(localModeCommand('plan', 'Switch this session to plan mode', planMode.id));
  }

  if (defaultMode) {
    commands.push(localModeCommand('default', `Switch this session to ${defaultMode.name} mode`, defaultMode.id));
  }

  return commands.filter((command, index, all) => (
    all.findIndex((candidate) => candidate.name === command.name) === index
  ));
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

function localModeCommand(name: string, description: string, modeId: string): AvailableCommand {
  return {
    name,
    description,
    _meta: {
      acpClientCommand: {
        kind: 'set-mode',
        modeId,
      } satisfies LocalCommandMeta,
    },
  };
}

function findMode(modes: SessionModeState, pattern: RegExp): { id: string; name: string } | null {
  const match = modes.availableModes.find((mode) => (
    pattern.test(mode.id) || pattern.test(mode.name)
  ));
  return match ? { id: match.id, name: match.name } : null;
}

export function getLocalCommandMeta(command: AvailableCommand): LocalCommandMeta | null {
  const meta = command._meta;
  if (!isRecord(meta)) {
    return null;
  }

  const clientCommand = meta.acpClientCommand;
  if (!isRecord(clientCommand) || clientCommand.kind !== 'set-mode' || typeof clientCommand.modeId !== 'string') {
    return null;
  }

  return {
    kind: 'set-mode',
    modeId: clientCommand.modeId,
  };
}
