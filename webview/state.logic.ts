import type { AvailableCommand, SessionModeState } from '@agentclientprotocol/sdk';

import type { ExtensionToWebviewMessage } from '../src/shared/bridge';
import type { ChatItem, PlanEntry, ToolCallStatus } from '../src/shared/chatModel';
import { createInitialState, type WebviewState } from './state';

export type WebviewAction =
  | { type: 'extensionMessage'; message: ExtensionToWebviewMessage }
  | { type: 'promptSubmitted'; text: string }
  | { type: 'clearError' };

export function reduceWebviewState(state: WebviewState, action: WebviewAction): WebviewState {
  switch (action.type) {
    case 'extensionMessage':
      return reduceExtensionMessage(state, action.message);
    case 'promptSubmitted':
      return addUserPrompt(state, action.text);
    case 'clearError':
      return { ...state, error: null };
    default:
      return state;
  }
}

function reduceExtensionMessage(
  state: WebviewState,
  message: ExtensionToWebviewMessage,
): WebviewState {
  switch (message.type) {
    case 'state': {
      const sessionChanged = state.activeSessionId !== message.activeSessionId;
      const session = message.session;
      return {
        ...state,
        session,
        activeSessionId: message.activeSessionId,
        modes: session?.modes ?? null,
        models: session?.models ?? null,
        availableCommands: session?.availableCommands ?? [],
        ...(sessionChanged ? emptyTimelineState() : undefined),
      };
    }
    case 'sessionUpdate':
      if (message.sessionId !== state.activeSessionId) {
        return state;
      }
      return applySessionUpdate(state, message.update);
    case 'promptStart':
      return {
        ...state,
        turnInProgress: true,
        error: null,
        currentAssistantMessageId: null,
        currentThoughtId: null,
      };
    case 'promptEnd':
      return finalizeStreamingItems({
        ...state,
        turnInProgress: false,
        currentAssistantMessageId: null,
        currentThoughtId: null,
      });
    case 'error':
      return appendItem(state, {
        kind: 'error',
        id: nextId(state, 'error'),
        text: message.message,
      }, { error: message.message });
    case 'clearChat':
      return {
        ...state,
        ...emptyTimelineState(),
        error: null,
        turnInProgress: false,
      };
    case 'modesUpdate':
      return {
        ...state,
        modes: message.modes,
        session: state.session ? { ...state.session, modes: message.modes } : null,
      };
    case 'modelsUpdate':
      return {
        ...state,
        models: message.models,
        session: state.session ? { ...state.session, models: message.models } : null,
      };
    default:
      return state;
  }
}

function applySessionUpdate(state: WebviewState, update: unknown): WebviewState {
  if (!isRecord(update) || typeof update.sessionUpdate !== 'string') {
    return state;
  }

  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return appendTextChunk(state, 'message', getContentText(update));
    case 'agent_thought_chunk':
      return appendTextChunk(state, 'thought', getContentText(update));
    case 'tool_call':
      return upsertToolCall(state, update);
    case 'tool_call_update':
      return updateToolCall(state, update);
    case 'plan':
      return upsertPlan(state, update);
    case 'available_commands_update':
      return updateAvailableCommands(state, update.availableCommands);
    case 'current_mode_update':
      return updateCurrentMode(state, update.currentModeId);
    default:
      return state;
  }
}

function addUserPrompt(state: WebviewState, text: string): WebviewState {
  const trimmed = text.trim();
  if (!trimmed) {
    return state;
  }

  return appendItem(state, {
    kind: 'message',
    id: nextId(state, 'user'),
    role: 'user',
    text: trimmed,
  }, {
    error: null,
    turnInProgress: true,
    currentAssistantMessageId: null,
    currentThoughtId: null,
  });
}

function appendTextChunk(
  state: WebviewState,
  target: 'message' | 'thought',
  text: string | null,
): WebviewState {
  if (text === null || (target === 'message' && text.length === 0)) {
    return state;
  }

  if (target === 'message') {
    const id = state.currentAssistantMessageId ?? nextId(state, 'assistant');
    const existing = findItem(state.items, id, 'message');
    if (existing) {
      return replaceItem(state, id, {
        ...existing,
        text: existing.text + text,
        streaming: true,
      });
    }

    return appendItem(state, {
      kind: 'message',
      id,
      role: 'assistant',
      text,
      streaming: true,
    }, {
      currentAssistantMessageId: id,
      currentThoughtId: state.currentThoughtId,
    });
  }

  const id = state.currentThoughtId ?? nextId(state, 'thought');
  const existing = findItem(state.items, id, 'thought');
  if (existing) {
    return replaceItem(state, id, {
      ...existing,
      text: existing.text + text,
      streaming: true,
    });
  }

  return appendItem(state, {
    kind: 'thought',
    id,
    text,
    streaming: true,
    collapsed: false,
  }, {
    currentThoughtId: id,
  });
}

function upsertToolCall(state: WebviewState, update: StringRecord): WebviewState {
  const id = typeof update.toolCallId === 'string' && update.toolCallId
    ? `tool-${update.toolCallId}`
    : nextId(state, 'tool');
  const existing = findItem(state.items, id, 'toolCall');
  const item: ChatItem = {
    kind: 'toolCall',
    id,
    title: typeof update.title === 'string' && update.title ? update.title : existing?.title ?? 'Tool Call',
    status: normalizeToolStatus(update.status, existing?.status ?? 'pending'),
    detail: getToolDetail(update) ?? existing?.detail,
  };

  return existing ? replaceItem(state, id, item) : appendItem(state, item);
}

function updateToolCall(state: WebviewState, update: StringRecord): WebviewState {
  const rawId = typeof update.toolCallId === 'string' && update.toolCallId ? update.toolCallId : 'unknown';
  const id = `tool-${rawId}`;
  const existing = findItem(state.items, id, 'toolCall');
  const item: ChatItem = {
    kind: 'toolCall',
    id,
    title: typeof update.title === 'string' && update.title
      ? update.title
      : existing?.title ?? 'Tool Call',
    status: normalizeToolStatus(update.status, existing?.status ?? 'completed'),
    detail: getToolDetail(update) ?? existing?.detail,
  };

  return existing ? replaceItem(state, id, item) : appendItem(state, item);
}

function upsertPlan(state: WebviewState, update: StringRecord): WebviewState {
  const entries = Array.isArray(update.entries) ? update.entries : [];
  const item: ChatItem = {
    kind: 'plan',
    id: 'plan-current',
    entries: entries.map((entry, index) => normalizePlanEntry(entry, index)),
  };
  const existing = findItem(state.items, item.id, 'plan');
  return existing ? replaceItem(state, item.id, item) : appendItem(state, item);
}

function updateAvailableCommands(state: WebviewState, commands: unknown): WebviewState {
  const availableCommands = Array.isArray(commands) ? commands as AvailableCommand[] : [];
  return {
    ...state,
    availableCommands,
    session: state.session ? { ...state.session, availableCommands } : null,
  };
}

function updateCurrentMode(state: WebviewState, currentModeId: unknown): WebviewState {
  if (typeof currentModeId !== 'string') {
    return state;
  }

  const modes = state.modes ? { ...state.modes, currentModeId } as SessionModeState : state.modes;
  return {
    ...state,
    modes,
    session: state.session ? { ...state.session, modes } : null,
  };
}

function finalizeStreamingItems(state: WebviewState): WebviewState {
  return {
    ...state,
    items: state.items.map((item) => {
      if ((item.kind === 'message' || item.kind === 'thought') && item.streaming) {
        return {
          ...item,
          streaming: false,
          ...(item.kind === 'thought' ? { collapsed: true } : undefined),
        };
      }
      return item;
    }),
  };
}

function replaceItem<T extends ChatItem>(state: WebviewState, id: string, item: T): WebviewState {
  return {
    ...state,
    items: state.items.map((current) => current.id === id ? item : current),
  };
}

function appendItem(
  state: WebviewState,
  item: ChatItem,
  extra?: Partial<WebviewState>,
): WebviewState {
  return {
    ...state,
    ...extra,
    items: [...state.items, item],
    nextItemId: state.nextItemId + 1,
  };
}

function findItem<K extends ChatItem['kind']>(
  items: ChatItem[],
  id: string,
  kind: K,
): Extract<ChatItem, { kind: K }> | undefined {
  return items.find((item): item is Extract<ChatItem, { kind: K }> => (
    item.id === id && item.kind === kind
  ));
}

function normalizeToolStatus(value: unknown, fallback: ToolCallStatus): ToolCallStatus {
  switch (value) {
    case 'pending':
      return 'pending';
    case 'in_progress':
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return fallback;
  }
}

function normalizePlanEntry(value: unknown, index: number): PlanEntry {
  const entry = isRecord(value) ? value : {};
  const content =
    firstString(entry.content, entry.title, entry.description, entry.text) ??
    `Step ${index + 1}`;
  const status = typeof entry.status === 'string' ? entry.status : undefined;

  return {
    id: firstString(entry.id, entry.entryId) ?? `plan-${index}`,
    text: content,
    completed: status === 'completed',
  };
}

function getContentText(update: StringRecord): string | null {
  const content = update.content;
  if (!isRecord(content)) {
    return null;
  }
  return content.type === 'text' && typeof content.text === 'string' ? content.text : null;
}

function getToolDetail(update: StringRecord): string | undefined {
  const rawOutput = update.rawOutput;
  if (typeof rawOutput === 'string' && rawOutput.trim()) {
    return rawOutput;
  }

  const content = update.content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!isRecord(part)) {
          return null;
        }
        if (part.type === 'content' && isRecord(part.content)) {
          return part.content.type === 'text' && typeof part.content.text === 'string'
            ? part.content.text
            : null;
        }
        return part.type === 'text' && typeof part.text === 'string' ? part.text : null;
      })
      .filter((part): part is string => Boolean(part))
      .join('\n');
    return text || undefined;
  }

  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function nextId(state: WebviewState, prefix: string): string {
  return `${prefix}-${state.nextItemId}`;
}

function emptyTimelineState(): Pick<
  WebviewState,
  'items' | 'currentAssistantMessageId' | 'currentThoughtId' | 'nextItemId'
> {
  return {
    items: [],
    currentAssistantMessageId: null,
    currentThoughtId: null,
    nextItemId: createInitialState().nextItemId,
  };
}

type StringRecord = Record<string, unknown>;

function isRecord(value: unknown): value is StringRecord {
  return typeof value === 'object' && value !== null;
}
