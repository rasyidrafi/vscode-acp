import type { AvailableCommand, SessionModeState, SessionModelState } from '@agentclientprotocol/sdk';

import type { AttachedFile, BridgeSessionState } from '../src/shared/bridge';
import type { ActivePlan, ActivityItem, ConversationMessage } from '../src/shared/chatModel';
import { isRecord } from './lib/typeGuards';

export interface SessionHistory {
  messages: ConversationMessage[];
  activities: ActivityItem[];
  activePlan: ActivePlan | null;
  attachedFiles: AttachedFile[];
  nextOrder: number;
  nextItemId: number;
  currentAssistantMessageId: string | null;
  currentThoughtId: string | null;
  turnInProgress: boolean;
}

export interface WebviewState {
  session: BridgeSessionState | null;
  activeSessionId: string | null;
  turnInProgress: boolean;
  error: string | null;
  messages: ConversationMessage[];
  activities: ActivityItem[];
  activePlan: ActivePlan | null;
  availableCommands: AvailableCommand[];
  attachedFiles: AttachedFile[];
  modes: SessionModeState | null;
  models: SessionModelState | null;
  currentAssistantMessageId: string | null;
  currentThoughtId: string | null;
  nextOrder: number;
  nextItemId: number;
  sessionsHistory: Record<string, SessionHistory>;
}

export type PersistedWebviewState = Pick<
  WebviewState,
  | 'session'
  | 'activeSessionId'
  | 'turnInProgress'
  | 'error'
  | 'messages'
  | 'activities'
  | 'activePlan'
  | 'availableCommands'
  | 'attachedFiles'
  | 'modes'
  | 'models'
  | 'currentAssistantMessageId'
  | 'currentThoughtId'
  | 'nextOrder'
  | 'nextItemId'
  | 'sessionsHistory'
>;

export function createInitialState(persisted?: PersistedWebviewState): WebviewState {
  return {
    session: persisted?.session ?? null,
    activeSessionId: persisted?.activeSessionId ?? null,
    turnInProgress: persisted?.turnInProgress ?? false,
    error: persisted?.error ?? null,
    messages: persisted?.messages ?? [],
    activities: persisted?.activities ?? [],
    activePlan: persisted?.activePlan ?? null,
    availableCommands: persisted?.availableCommands ?? [],
    attachedFiles: persisted?.attachedFiles ?? [],
    modes: persisted?.modes ?? null,
    models: persisted?.models ?? null,
    currentAssistantMessageId: persisted?.currentAssistantMessageId ?? null,
    currentThoughtId: persisted?.currentThoughtId ?? null,
    nextOrder: persisted?.nextOrder ?? 1,
    nextItemId: persisted?.nextItemId ?? 1,
    sessionsHistory: persisted?.sessionsHistory ?? {},
  };
}

export function toPersistedState(state: WebviewState): PersistedWebviewState {
  return {
    session: state.session,
    activeSessionId: state.activeSessionId,
    turnInProgress: state.turnInProgress,
    error: state.error,
    messages: state.messages,
    activities: state.activities,
    activePlan: state.activePlan,
    availableCommands: state.availableCommands,
    attachedFiles: state.attachedFiles,
    modes: state.modes,
    models: state.models,
    currentAssistantMessageId: state.currentAssistantMessageId,
    currentThoughtId: state.currentThoughtId,
    nextOrder: state.nextOrder,
    nextItemId: state.nextItemId,
    sessionsHistory: state.sessionsHistory,
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
    Array.isArray(value.messages) &&
    Array.isArray(value.activities) &&
    (value.activePlan === undefined || value.activePlan === null || isRecord(value.activePlan)) &&
    Array.isArray(value.availableCommands) &&
    (value.attachedFiles === undefined || Array.isArray(value.attachedFiles)) &&
    (value.modes === null || isRecord(value.modes)) &&
    (value.models === null || isRecord(value.models)) &&
    (value.currentAssistantMessageId === null || typeof value.currentAssistantMessageId === 'string') &&
    (value.currentThoughtId === null || typeof value.currentThoughtId === 'string') &&
    typeof value.nextOrder === 'number' &&
    typeof value.nextItemId === 'number' &&
    (value.sessionsHistory === undefined || isRecord(value.sessionsHistory))
  );
}
