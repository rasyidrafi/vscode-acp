import type { AvailableCommand, SessionModeState, SessionModelState } from '@agentclientprotocol/sdk';

import type { BridgeSessionState } from '../src/shared/bridge';
import type { ChatItem } from '../src/shared/chatModel';

export interface WebviewState {
  session: BridgeSessionState | null;
  activeSessionId: string | null;
  turnInProgress: boolean;
  error: string | null;
  items: ChatItem[];
  availableCommands: AvailableCommand[];
  modes: SessionModeState | null;
  models: SessionModelState | null;
  currentAssistantMessageId: string | null;
  currentThoughtId: string | null;
  nextItemId: number;
}

export type PersistedWebviewState = Pick<
  WebviewState,
  | 'session'
  | 'activeSessionId'
  | 'turnInProgress'
  | 'error'
  | 'items'
  | 'availableCommands'
  | 'modes'
  | 'models'
  | 'currentAssistantMessageId'
  | 'currentThoughtId'
  | 'nextItemId'
>;

export function createInitialState(persisted?: PersistedWebviewState): WebviewState {
  return {
    session: persisted?.session ?? null,
    activeSessionId: persisted?.activeSessionId ?? null,
    turnInProgress: persisted?.turnInProgress ?? false,
    error: persisted?.error ?? null,
    items: persisted?.items ?? [],
    availableCommands: persisted?.availableCommands ?? [],
    modes: persisted?.modes ?? null,
    models: persisted?.models ?? null,
    currentAssistantMessageId: persisted?.currentAssistantMessageId ?? null,
    currentThoughtId: persisted?.currentThoughtId ?? null,
    nextItemId: persisted?.nextItemId ?? 1,
  };
}

export function toPersistedState(state: WebviewState): PersistedWebviewState {
  return {
    session: state.session,
    activeSessionId: state.activeSessionId,
    turnInProgress: state.turnInProgress,
    error: state.error,
    items: state.items,
    availableCommands: state.availableCommands,
    modes: state.modes,
    models: state.models,
    currentAssistantMessageId: state.currentAssistantMessageId,
    currentThoughtId: state.currentThoughtId,
    nextItemId: state.nextItemId,
  };
}

export function isPersistedWebviewState(value: unknown): value is PersistedWebviewState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.session === null || isRecord(value.session)) &&
    (value.activeSessionId === null || typeof value.activeSessionId === 'string') &&
    typeof value.turnInProgress === 'boolean' &&
    (value.error === null || typeof value.error === 'string') &&
    Array.isArray(value.items) &&
    Array.isArray(value.availableCommands) &&
    (value.modes === null || isRecord(value.modes)) &&
    (value.models === null || isRecord(value.models)) &&
    (value.currentAssistantMessageId === null || typeof value.currentAssistantMessageId === 'string') &&
    (value.currentThoughtId === null || typeof value.currentThoughtId === 'string') &&
    typeof value.nextItemId === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
