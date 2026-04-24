import type {
  AvailableCommand,
  PromptResponse,
  SessionModeState,
  SessionModelState,
} from '@agentclientprotocol/sdk';
import type { BridgeSessionUpdate } from './acpAdapters';

export interface BridgeSessionState {
  sessionId: string;
  agentName: string;
  cwd: string;
  modes: SessionModeState | null;
  models: SessionModelState | null;
  availableCommands: AvailableCommand[];
}

export interface AttachedFile {
  path: string;
  name: string;
}

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'sendPrompt'; text: string }
  | { type: 'cancelTurn' }
  | { type: 'setMode'; modeId: string }
  | { type: 'setModel'; modelId: string }
  | { type: 'executeCommand'; command: string }
  | { type: 'clearError' };

export type ExtensionToWebviewMessage =
  | {
      type: 'state';
      activeSessionId: string | null;
      session: BridgeSessionState | null;
    }
  | {
      type: 'sessionUpdate';
      sessionId: string;
      update: BridgeSessionUpdate;
    }
  | { type: 'promptStart' }
  | {
      type: 'promptEnd';
      stopReason?: PromptResponse['stopReason'] | 'error';
      usage?: unknown;
    }
  | { type: 'error'; message: string }
  | { type: 'clearChat' }
  | { type: 'fileAttached'; file: AttachedFile }
  | { type: 'modesUpdate'; modes: SessionModeState | null }
  | { type: 'modelsUpdate'; models: SessionModelState | null };

export function isWebviewToExtensionMessage(value: unknown): value is WebviewToExtensionMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'ready':
    case 'cancelTurn':
    case 'clearError':
      return true;
    case 'sendPrompt':
      return typeof value.text === 'string';
    case 'setMode':
      return typeof value.modeId === 'string';
    case 'setModel':
      return typeof value.modelId === 'string';
    case 'executeCommand':
      return typeof value.command === 'string';
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
