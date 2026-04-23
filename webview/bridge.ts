import type { WebviewToExtensionMessage } from '../src/shared/bridge';

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
