import type { AvailableCommand, SessionModeState } from '@agentclientprotocol/sdk';
import type { BridgeSessionUpdate, SupportedSessionUpdate } from '../src/shared/acpAdapters';

import type { ExtensionToWebviewMessage } from '../src/shared/bridge';
import type {
  ActivePlan,
  ActivityItem,
  ConversationMessage,
  PlanEntry,
  PlanEntryStatus,
  ToolCallStatus,
} from '../src/shared/chatModel';
import { createInitialState, type WebviewState } from './state';

export type WebviewAction =
  | { type: 'extensionMessage'; message: ExtensionToWebviewMessage }
  | { type: 'promptSubmitted'; text: string }
  | { type: 'attachmentsConsumed' }
  | { type: 'removeAttachment'; path: string }
  | { type: 'clearError' };

export function reduceWebviewState(state: WebviewState, action: WebviewAction): WebviewState {
  switch (action.type) {
    case 'extensionMessage':
      return reduceExtensionMessage(state, action.message);
    case 'promptSubmitted':
      return addUserPrompt(state, action.text);
    case 'attachmentsConsumed':
      return { ...state, attachedFiles: [] };
    case 'removeAttachment':
      return {
        ...state,
        attachedFiles: state.attachedFiles.filter((file) => file.path !== action.path),
      };
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
      const oldSessionId = state.activeSessionId;
      const newSessionId = message.activeSessionId;
      const sessionChanged = oldSessionId !== newSessionId;
      const session = message.session;

      let nextState = {
        ...state,
        session,
        activeSessionId: newSessionId,
        modes: session?.modes ?? null,
        models: session?.models ?? null,
        availableCommands: session?.availableCommands ?? [],
      };

      if (sessionChanged) {
        // Save current history if there was an active session
        const updatedHistory = { ...state.sessionsHistory };
        if (oldSessionId) {
          updatedHistory[oldSessionId] = {
            messages: state.messages,
            activities: state.activities,
            activePlan: state.activePlan,
            attachedFiles: state.attachedFiles,
            nextOrder: state.nextOrder,
            nextItemId: state.nextItemId,
            currentAssistantMessageId: state.currentAssistantMessageId,
            currentThoughtId: state.currentThoughtId,
            turnInProgress: state.turnInProgress,
          };
        }

        // Restore history for the new session if it exists
        const restoredHistory = newSessionId ? updatedHistory[newSessionId] : undefined;

        if (restoredHistory) {
          nextState = {
            ...nextState,
            messages: restoredHistory.messages,
            activities: restoredHistory.activities,
            activePlan: restoredHistory.activePlan,
            attachedFiles: restoredHistory.attachedFiles,
            nextOrder: restoredHistory.nextOrder,
            nextItemId: restoredHistory.nextItemId,
            currentAssistantMessageId: restoredHistory.currentAssistantMessageId,
            currentThoughtId: restoredHistory.currentThoughtId,
            turnInProgress: restoredHistory.turnInProgress,
            sessionsHistory: updatedHistory,
          };
        } else {
          nextState = {
            ...nextState,
            ...emptyTimelineState(),
            attachedFiles: [],
            turnInProgress: false,
            sessionsHistory: updatedHistory,
          };
        }
      }

      return nextState;
    }
    case 'sessionUpdate': {
      const { sessionId, update } = message;
      if (sessionId === state.activeSessionId) {
        return applySessionUpdate(state, update);
      } else {
        // Background session update
        const history = state.sessionsHistory[sessionId];
        if (!history) {
          return state;
        }

        const tempState: WebviewState = {
          ...state,
          messages: history.messages,
          activities: history.activities,
          activePlan: history.activePlan,
          attachedFiles: history.attachedFiles,
          nextOrder: history.nextOrder,
          nextItemId: history.nextItemId,
          currentAssistantMessageId: history.currentAssistantMessageId,
          currentThoughtId: history.currentThoughtId,
          turnInProgress: history.turnInProgress,
        };

        const updatedTempState = applySessionUpdate(tempState, update);

        return {
          ...state,
          sessionsHistory: {
            ...state.sessionsHistory,
            [sessionId]: {
              messages: updatedTempState.messages,
              activities: updatedTempState.activities,
              activePlan: updatedTempState.activePlan,
              attachedFiles: updatedTempState.attachedFiles,
              nextOrder: updatedTempState.nextOrder,
              nextItemId: updatedTempState.nextItemId,
              currentAssistantMessageId: updatedTempState.currentAssistantMessageId,
              currentThoughtId: updatedTempState.currentThoughtId,
              turnInProgress: updatedTempState.turnInProgress,
            },
          },
        };
      }
    }
    case 'promptStart':
      // This usually only happens for the active session since the user initiated it
      return {
        ...state,
        turnInProgress: true,
        error: null,
        currentAssistantMessageId: null,
        currentThoughtId: null,
      };
    case 'promptEnd':
      // This also usually only happens for the active session
      return finalizeStreamingItems({
        ...state,
        turnInProgress: false,
        currentAssistantMessageId: null,
        currentThoughtId: null,
      });
    case 'error':
      return appendActivity(state, {
        order: nextOrder(state),
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
        attachedFiles: [],
        activePlan: null,
      };
    case 'fileAttached':
      return {
        ...state,
        attachedFiles: upsertAttachedFile(state.attachedFiles, message.file),
        error: null,
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

function upsertAttachedFile(
  files: WebviewState['attachedFiles'],
  file: WebviewState['attachedFiles'][number],
): WebviewState['attachedFiles'] {
  return [
    ...files.filter((current) => current.path !== file.path),
    file,
  ];
}

function applySessionUpdate(state: WebviewState, update: BridgeSessionUpdate): WebviewState {
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
    case 'unsupported':
    default:
      return state;
  }
}

function addUserPrompt(state: WebviewState, text: string): WebviewState {
  const trimmed = text.trim();
  if (!trimmed) {
    return state;
  }

  return appendMessage(state, {
    order: nextOrder(state),
    kind: 'message',
    id: nextId(state, 'user'),
    role: 'user',
    text: trimmed,
    createdAt: new Date().toISOString(),
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
    const segmentedState = clearCurrentThoughtSegment(state);
    const id = segmentedState.currentAssistantMessageId ?? nextId(segmentedState, 'assistant');
    const existing = findMessage(segmentedState.messages, id);
    if (existing) {
      return replaceMessage(segmentedState, id, {
        ...existing,
        text: existing.text + text,
        streaming: true,
      });
    }

    return appendMessage(segmentedState, {
      order: nextOrder(segmentedState),
      kind: 'message',
      id,
      role: 'assistant',
      text,
      createdAt: new Date().toISOString(),
      streaming: true,
    }, {
      currentAssistantMessageId: id,
      currentThoughtId: null,
    });
  }

  const segmentedState = closeCurrentAssistantMessageSegment(state);
  const id = segmentedState.currentThoughtId ?? nextId(segmentedState, 'thought');
  const existing = findActivity(segmentedState.activities, id, 'thought');
  if (existing) {
    return replaceActivity(segmentedState, id, {
      ...existing,
      text: existing.text + text,
      streaming: true,
    });
  }

  return appendActivity(segmentedState, {
    order: nextOrder(segmentedState),
    kind: 'thought',
    id,
    text,
    streaming: true,
    collapsed: true,
  }, {
    currentThoughtId: id,
  });
}

function upsertToolCall(
  state: WebviewState,
  update: Extract<SupportedSessionUpdate, { sessionUpdate: 'tool_call' }>,
): WebviewState {
  const segmentedState = clearCurrentThoughtSegment(closeCurrentAssistantMessageSegment(state));
  const id = typeof update.toolCallId === 'string' && update.toolCallId
    ? `tool-${update.toolCallId}`
    : nextId(segmentedState, 'tool');
  const existing = findActivity(segmentedState.activities, id, 'toolCall');
  const presentation = deriveToolCallPresentation(update, {
    fallbackTitle: existing?.title ?? 'Tool Call',
    fallbackDetail: existing?.detail,
  });

  const input = update.rawInput ? stringifyAny(update.rawInput) : undefined;
  const output = update.rawOutput ? stringifyAny(update.rawOutput) : (update.content ? stringifyAny(update.content) : undefined);

  const item: ActivityItem = {
    order: existing?.order ?? nextOrder(segmentedState),
    kind: 'toolCall',
    id,
    title: presentation.title,
    status: normalizeToolStatus(update.status, existing?.status ?? 'pending'),
    detail: presentation.detail,
    input: input ?? existing?.input,
    output: output ?? existing?.output,
    toolKind: update.kind ?? existing?.toolKind,
    locations: update.locations?.map((loc) => ({ path: loc.path })) ?? existing?.locations,
  };

  return existing ? replaceActivity(segmentedState, id, item) : appendActivity(segmentedState, item);
}

function updateToolCall(
  state: WebviewState,
  update: Extract<SupportedSessionUpdate, { sessionUpdate: 'tool_call_update' }>,
): WebviewState {
  const segmentedState = clearCurrentThoughtSegment(closeCurrentAssistantMessageSegment(state));
  const rawId = typeof update.toolCallId === 'string' && update.toolCallId ? update.toolCallId : 'unknown';
  const id = `tool-${rawId}`;
  const existing = findActivity(segmentedState.activities, id, 'toolCall');
  const presentation = deriveToolCallPresentation(update, {
    fallbackTitle: existing?.title ?? 'Tool Call',
    fallbackDetail: existing?.detail,
  });

  const input = update.rawInput ? stringifyAny(update.rawInput) : undefined;
  const output = update.rawOutput ? stringifyAny(update.rawOutput) : (update.content ? stringifyAny(update.content) : undefined);
  const error = 'error' in update ? stringifyAny(update.error) : undefined;

  const item: ActivityItem = {
    order: existing?.order ?? nextOrder(segmentedState),
    kind: 'toolCall',
    id,
    title: presentation.title,
    status: normalizeToolStatus(update.status, existing?.status ?? 'completed'),
    detail: presentation.detail,
    input: input ?? existing?.input,
    output: error ?? output ?? existing?.output,
    toolKind: update.kind ?? existing?.toolKind,
    locations: update.locations?.map((loc) => ({ path: loc.path })) ?? existing?.locations,
  };

  return existing ? replaceActivity(segmentedState, id, item) : appendActivity(segmentedState, item);
}

function stringifyAny(val: unknown): string {
  if (typeof val === 'string') {
    return val;
  }
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

function upsertPlan(
  state: WebviewState,
  update: Extract<SupportedSessionUpdate, { sessionUpdate: 'plan' }>,
): WebviewState {
  const entries = update.entries;
  const explanation = 'explanation' in update && typeof update.explanation === 'string' && update.explanation.trim()
    ? update.explanation
    : undefined;
  const item: ActivePlan = {
    id: 'plan-current',
    explanation,
    entries: entries.map((entry, index) => normalizePlanEntry(entry, index)),
  };
  return {
    ...state,
    activePlan: item.entries.length > 0 ? item : null,
  };
}

function updateAvailableCommands(state: WebviewState, commands: AvailableCommand[]): WebviewState {
  const availableCommands = commands;
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
    messages: state.messages.map((item) => {
      if (item.streaming) {
        return { ...item, streaming: false };
      }
      return item;
    }),
    activities: state.activities.map((item) => {
      if (item.kind === 'thought' && item.streaming) {
        return {
          ...item,
          streaming: false,
          collapsed: true,
        };
      }
      return item;
    }),
  };
}

function replaceMessage(state: WebviewState, id: string, item: ConversationMessage): WebviewState {
  return {
    ...state,
    messages: state.messages.map((current) => current.id === id ? item : current),
  };
}

function replaceActivity(state: WebviewState, id: string, item: ActivityItem): WebviewState {
  return {
    ...state,
    activities: state.activities.map((current) => current.id === id ? item : current),
  };
}

function appendMessage(
  state: WebviewState,
  item: ConversationMessage,
  extra?: Partial<WebviewState>,
): WebviewState {
  return {
    ...state,
    ...extra,
    messages: [...state.messages, item],
    nextOrder: state.nextOrder + 1,
    nextItemId: state.nextItemId + 1,
  };
}

function appendActivity(
  state: WebviewState,
  item: ActivityItem,
  extra?: Partial<WebviewState>,
): WebviewState {
  return {
    ...state,
    ...extra,
    activities: [...state.activities, item],
    nextOrder: state.nextOrder + 1,
    nextItemId: state.nextItemId + 1,
  };
}

function closeCurrentAssistantMessageSegment(state: WebviewState): WebviewState {
  if (!state.currentAssistantMessageId) {
    return state;
  }

  const current = findMessage(state.messages, state.currentAssistantMessageId);
  if (!current) {
    return {
      ...state,
      currentAssistantMessageId: null,
    };
  }

  return {
    ...state,
    currentAssistantMessageId: null,
    messages: state.messages.map((item) => (
      item.id === current.id && item.streaming
        ? { ...item, streaming: false }
        : item
    )),
  };
}

function clearCurrentThoughtSegment(state: WebviewState): WebviewState {
  if (!state.currentThoughtId) {
    return state;
  }

  const current = findActivity(state.activities, state.currentThoughtId, 'thought');
  if (!current) {
    return {
      ...state,
      currentThoughtId: null,
    };
  }

  return {
    ...state,
    currentThoughtId: null,
    activities: state.activities.map((item) => (
      item.id === current.id && item.kind === 'thought' && item.streaming
        ? { ...item, streaming: false, collapsed: true }
        : item
    )),
  };
}

function findMessage(
  items: ConversationMessage[],
  id: string,
): ConversationMessage | undefined {
  return items.find((item) => item.id === id);
}

function findActivity<K extends ActivityItem['kind']>(
  items: ActivityItem[],
  id: string,
  kind: K,
): Extract<ActivityItem, { kind: K }> | undefined {
  return items.find((item): item is Extract<ActivityItem, { kind: K }> => item.id === id && item.kind === kind);
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
  const status = normalizePlanStatus(entry.status);

  return {
    id: firstString(entry.id, entry.entryId) ?? `plan-${index}`,
    text: content,
    status,
  };
}

function normalizePlanStatus(value: unknown): PlanEntryStatus {
  switch (value) {
    case 'completed':
      return 'completed';
    case 'inProgress':
    case 'in_progress':
    case 'running':
      return 'inProgress';
    default:
      return 'pending';
  }
}

function getContentText(
  update: Extract<SupportedSessionUpdate, { sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk' }>,
): string | null {
  const content = update.content;
  if (!isRecord(content)) {
    return null;
  }
  return content.type === 'text' && typeof content.text === 'string' ? content.text : null;
}

function getToolDetail(
  update: Extract<SupportedSessionUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>,
): string | undefined {
  const rawOutput = update.rawOutput;
  if (typeof rawOutput === 'string' && rawOutput.trim()) {
    return rawOutput;
  }

  const content = update.content as unknown;
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
        return typeof part.text === 'string' ? part.text : null;
      })
      .filter((part): part is string => Boolean(part))
      .join('\n');
    return text || undefined;
  }

  return undefined;
}

function deriveToolCallPresentation(
  update: Extract<SupportedSessionUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>,
  options: { fallbackTitle: string; fallbackDetail?: string },
): { title: string; detail?: string } {
  const rawTitle = firstString(update.title) ?? options.fallbackTitle;
  const lowerTitle = rawTitle.toLowerCase();
  const command = extractToolCommand(update);
  const path = extractPrimaryPath(update);
  const outputSummary = summarizeToolOutput(update);
  const status = update.status;
  const kind = update.kind;

  // 1. First priority: tool kind from protocol
  if (kind === 'execute') {
    let title = 'Ran command';
    if (status === 'running' || status === 'in_progress') {
      title = 'Running command';
    } else if (status === 'failed') {
      title = 'Failed to run command';
    }
    return {
      title,
      detail: command ?? rawTitle,
    };
  }

  if (kind === 'edit') {
    let title = 'Edited files';
    if (status === 'running' || status === 'in_progress') {
      title = 'Editing files';
    } else if (status === 'completed') {
      title = 'Edited files';
    } else if (status === 'failed') {
      title = 'Failed to edit files';
    }
    return {
      title,
      detail: path ?? outputSummary ?? options.fallbackDetail,
    };
  }

  if (kind === 'read') {
    let title = 'Read file';
    if (status === 'running' || status === 'in_progress') {
      title = 'Reading file';
    } else if (status === 'completed') {
      title = 'Read file';
    } else if (status === 'failed') {
      title = 'Failed to read file';
    }
    return {
      title,
      detail: outputSummary ?? rawTitle ?? options.fallbackDetail,
    };
  }

  if (kind === 'search') {
    let title = 'Searched project';
    if (status === 'running' || status === 'in_progress') {
      title = 'Searching project';
    } else if (status === 'failed') {
      title = 'Failed to search project';
    }
    const query = extractSearchQuery(update);
    return {
      title,
      detail: query ?? outputSummary ?? rawTitle ?? options.fallbackDetail,
    };
  }

  // 2. Second priority: fallback to title-based heuristics
  if (command) {
    let title = 'Ran command';
    if (status === 'running' || status === 'in_progress') {
      title = 'Running command';
    } else if (status === 'failed') {
      title = 'Failed to run command';
    }
    return {
      title,
      detail: command,
    };
  }

  if (
    lowerTitle.includes('write') ||
    lowerTitle.includes('edit') ||
    lowerTitle.includes('create') ||
    lowerTitle.includes('move') ||
    lowerTitle.includes('rename') ||
    lowerTitle.includes('delete') ||
    lowerTitle.includes('patch')
  ) {
    let title = 'Edited files';
    if (status === 'running' || status === 'in_progress') {
      title = 'Editing files';
    } else if (status === 'completed') {
      title = 'Edited files';
    } else if (status === 'failed') {
      title = 'Failed to edit files';
    }
    return {
      title,
      detail: path ?? outputSummary ?? options.fallbackDetail,
    };
  }

  if (lowerTitle.includes('read') || lowerTitle.includes('view')) {
    let title = 'Read file';
    if (status === 'running' || status === 'in_progress') {
      title = 'Reading file';
    } else if (status === 'completed') {
      title = 'Read file';
    } else if (status === 'failed') {
      title = 'Failed to read file';
    }
    return {
      title,
      detail: outputSummary ?? rawTitle ?? options.fallbackDetail,
    };
  }

  if (
    lowerTitle.includes('search') ||
    lowerTitle.includes('grep') ||
    lowerTitle.includes('find')
  ) {
    let title = 'Searched project';
    if (status === 'running' || status === 'in_progress') {
      title = 'Searching project';
    } else if (status === 'failed') {
      title = 'Failed to search project';
    }
    const query = extractSearchQuery(update);
    return {
      title,
      detail: query ?? outputSummary ?? rawTitle ?? options.fallbackDetail,
    };
  }

  return {
    title: rawTitle,
    detail: outputSummary ?? options.fallbackDetail,
  };
}

function extractToolCommand(
  update: Extract<SupportedSessionUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>,
): string | undefined {
  const rawInput = isRecord(update.rawInput) ? update.rawInput : undefined;
  const candidates: unknown[] = [
    rawInput?.command,
    rawInput?.cmd,
  ];

  for (const candidate of candidates) {
    const command = normalizeCommandValue(candidate);
    if (command) {
      return command;
    }
  }

  const executable = firstString(rawInput?.executable, rawInput?.program);
  const args = normalizeCommandValue(rawInput?.args);
  if (executable && args) {
    return `${executable} ${args}`;
  }

  if (update.kind === 'execute') {
    return update.title;
  }

  return executable ?? undefined;
}

function normalizeCommandValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parts = value
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function extractPrimaryPath(
  update: Extract<SupportedSessionUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>,
): string | undefined {
  const paths: string[] = [];
  collectPaths(update, paths, new Set<string>(), 0);
  return paths[paths.length - 1];
}

function collectPaths(
  value: unknown,
  paths: string[],
  seen: Set<string>,
  depth: number,
): void {
  if (depth > 4 || paths.length >= 6) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPaths(entry, paths, seen, depth + 1);
      if (paths.length >= 6) {
        return;
      }
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const key of ['path', 'filePath', 'filename', 'newPath', 'oldPath', 'target']) {
    const candidate = firstString(value[key]);
    if (!candidate || !looksPathLike(candidate) || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    paths.push(candidate);
  }

  for (const key of ['rawInput', 'rawOutput', 'content', 'item', 'input', 'result', 'changes', 'locations']) {
    if (key in value) {
      collectPaths(value[key], paths, seen, depth + 1);
    }
  }
}

function looksPathLike(value: string): boolean {
  return (
    value.includes('/') ||
    value.includes('\\') ||
    value.startsWith('.') ||
    /\.[a-z0-9]{1,12}$/iu.test(value)
  );
}

function extractSearchQuery(
  update: Extract<SupportedSessionUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>,
): string | undefined {
  const rawInput = isRecord(update.rawInput) ? update.rawInput : undefined;
  return firstString(
    rawInput?.query,
    rawInput?.pattern,
    rawInput?.searchTerm,
    rawInput?.term,
  );
}

function summarizeToolOutput(
  update: Extract<SupportedSessionUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>,
): string | undefined {
  const detailText = getToolDetail(update);
  if (detailText) {
    return summarizeText(detailText);
  }

  const title = firstString(update.title);
  if (title) {
    return title;
  }

  const path = extractPrimaryPath(update);
  if (path) {
    return path;
  }

  const rawOutput = update.rawOutput;
  if (typeof rawOutput === 'string') {
    return summarizeText(rawOutput);
  }
  if (isRecord(rawOutput)) {
    return firstString(rawOutput.path, rawOutput.filePath)
      ?? summarizeText(firstString(rawOutput.stdout, rawOutput.output, rawOutput.content));
  }

  return undefined;
}

function summarizeText(value: string | undefined | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const firstLine = lines[0];
  if (!firstLine) {
    return undefined;
  }

  return firstLine.length > 120 ? `${firstLine.slice(0, 117).trimEnd()}...` : firstLine;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function nextId(state: WebviewState, prefix: string): string {
  return `${prefix}-${state.nextItemId}`;
}

function nextOrder(state: WebviewState): number {
  return state.nextOrder;
}

function emptyTimelineState(): Pick<
  WebviewState,
  'messages' | 'activities' | 'activePlan' | 'currentAssistantMessageId' | 'currentThoughtId' | 'nextOrder' | 'nextItemId'
> {
  return {
    messages: [],
    activities: [],
    activePlan: null,
    currentAssistantMessageId: null,
    currentThoughtId: null,
    nextOrder: createInitialState().nextOrder,
    nextItemId: createInitialState().nextItemId,
  };
}

type StringRecord = Record<string, unknown>;

function isRecord(value: unknown): value is StringRecord {
  return typeof value === 'object' && value !== null;
}
