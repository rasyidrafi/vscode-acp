import type {
  AvailableCommand,
  SessionModelState,
} from '@agentclientprotocol/sdk';
import type {
  AvailableCommandsUpdate,
  ContentChunk,
  CurrentModeUpdate,
  Plan,
  SessionNotification,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk/dist/schema';
import { isRecord } from './typeGuards';

export type SupportedSessionUpdate =
  | (ContentChunk & { sessionUpdate: 'agent_message_chunk' })
  | (ContentChunk & { sessionUpdate: 'agent_thought_chunk' })
  | (ToolCall & { sessionUpdate: 'tool_call' })
  | (ToolCallUpdate & { sessionUpdate: 'tool_call_update' })
  | (Plan & { sessionUpdate: 'plan' })
  | (AvailableCommandsUpdate & { sessionUpdate: 'available_commands_update' })
  | (CurrentModeUpdate & { sessionUpdate: 'current_mode_update' });

export interface UnsupportedSessionUpdate {
  sessionUpdate: 'unsupported';
  originalType?: string;
  raw: unknown;
}

export type BridgeSessionUpdate = SupportedSessionUpdate | UnsupportedSessionUpdate;

export interface BridgeSessionNotification {
  sessionId: string;
  update: BridgeSessionUpdate;
}

export function adaptSessionNotification(notification: SessionNotification): BridgeSessionNotification {
  return {
    sessionId: notification.sessionId,
    update: adaptSessionUpdate(notification.update),
  };
}

export function adaptSessionUpdate(update: unknown): BridgeSessionUpdate {
  if (!isRecord(update) || typeof update.sessionUpdate !== 'string') {
    return unsupported(update);
  }

  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
    case 'agent_thought_chunk':
      return isContentChunkUpdate(update) ? update : unsupported(update, update.sessionUpdate);
    case 'tool_call':
      return isToolCallUpdateShape(update) ? update : unsupported(update, update.sessionUpdate);
    case 'tool_call_update':
      return isToolCallStatusUpdateShape(update) ? update : unsupported(update, update.sessionUpdate);
    case 'plan':
      return isPlanUpdateShape(update) ? update : unsupported(update, update.sessionUpdate);
    case 'available_commands_update':
      return isAvailableCommandsUpdateShape(update) ? update : unsupported(update, update.sessionUpdate);
    case 'current_mode_update':
      return isCurrentModeUpdateShape(update) ? update : unsupported(update, update.sessionUpdate);
    default:
      return unsupported(update, update.sessionUpdate);
  }
}

export function getSessionUpdateLabel(update: BridgeSessionUpdate): string {
  return update.sessionUpdate === 'unsupported'
    ? update.originalType ?? 'unknown'
    : update.sessionUpdate;
}

export function getAvailableCommands(update: BridgeSessionUpdate): AvailableCommand[] | null {
  if (update.sessionUpdate !== 'available_commands_update') {
    return null;
  }
  return update.availableCommands;
}

export function getSessionModels(response: { models?: unknown }): SessionModelState | null {
  const value = response.models;
  return isSessionModelState(value) ? value : null;
}

function unsupported(raw: unknown, originalType?: string): UnsupportedSessionUpdate {
  return {
    sessionUpdate: 'unsupported',
    originalType,
    raw,
  };
}

function isContentChunkUpdate(value: Record<string, unknown>): value is SupportedSessionUpdate {
  return isRecord(value.content) && typeof value.content.type === 'string';
}

function isToolCallUpdateShape(value: Record<string, unknown>): value is ToolCall & { sessionUpdate: 'tool_call' } {
  return typeof value.toolCallId === 'string' && typeof value.title === 'string';
}

function isToolCallStatusUpdateShape(value: Record<string, unknown>): value is ToolCallUpdate & { sessionUpdate: 'tool_call_update' } {
  return typeof value.toolCallId === 'string';
}

function isPlanUpdateShape(value: Record<string, unknown>): value is Plan & { sessionUpdate: 'plan' } {
  return Array.isArray(value.entries);
}

function isAvailableCommandsUpdateShape(value: Record<string, unknown>): value is AvailableCommandsUpdate & { sessionUpdate: 'available_commands_update' } {
  return Array.isArray(value.availableCommands) && value.availableCommands.every(isAvailableCommand);
}

function isCurrentModeUpdateShape(value: Record<string, unknown>): value is CurrentModeUpdate & { sessionUpdate: 'current_mode_update' } {
  return typeof value.currentModeId === 'string';
}

function isAvailableCommand(value: unknown): value is AvailableCommand {
  return isRecord(value) && typeof value.name === 'string';
}

function isSessionModelState(value: unknown): value is SessionModelState {
  return isRecord(value)
    && typeof value.currentModelId === 'string'
    && Array.isArray(value.availableModels);
}

export type { SessionUpdate };
