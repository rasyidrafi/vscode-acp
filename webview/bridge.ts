import type { WebviewToExtensionMessage } from '../src/shared/bridge';
import { isPersistedWebviewState, type PersistedWebviewState } from './state';

interface VsCodeApi {
  postMessage(message: WebviewToExtensionMessage): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare const acquireVsCodeApi: (() => VsCodeApi) | undefined;

const vscode = typeof acquireVsCodeApi === 'function'
  ? acquireVsCodeApi()
  : {
      postMessage: (message: WebviewToExtensionMessage) => {
        console.info('VS Code API unavailable', message);
      },
      getState: () => undefined,
      setState: () => undefined,
    };

export function postToExtension(message: WebviewToExtensionMessage): void {
  vscode.postMessage(message);
}

export function getPersistedState(): PersistedWebviewState | undefined {
  const value = vscode.getState<unknown>();
  return isPersistedWebviewState(value) ? value : undefined;
}

export function setPersistedState(state: PersistedWebviewState): void {
  vscode.setState(state);
}
