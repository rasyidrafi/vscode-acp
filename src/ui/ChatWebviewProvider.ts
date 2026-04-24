import * as vscode from 'vscode';
import { SessionManager } from '../core/SessionManager';
import { SessionUpdateHandler, SessionUpdateListener } from '../handlers/SessionUpdateHandler';
import type { SessionModeState, SessionModelState } from '@agentclientprotocol/sdk';
import { logError } from '../utils/Logger';
import { sendEvent } from '../utils/TelemetryManager';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../shared/bridge';
import { isWebviewToExtensionMessage } from '../shared/bridge';
import { getAvailableCommands, type BridgeSessionNotification } from '../shared/acpAdapters';
import { getChatWebviewHtml } from './webviewHtml';

/**
 * WebviewViewProvider for the ACP chat sidebar.
 * Wires VS Code webview lifecycle, bridge messages, and session actions.
 */
export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'acp-chat';

  private view?: vscode.WebviewView;
  private updateListener: SessionUpdateListener;
  private syncedTimelineSessionId: string | null = null;
  private syncedHasChatContent = false;
  private readonly allowedCommands = new Set([
    'acp.connectAgent',
    'acp.addAgent',
    'acp.browseRegistry',
    'acp.newConversation',
    'acp.attachFile',
    'acp.cancelTurn',
    'acp.disconnectAgent',
    'acp.restartAgent',
    'acp.showLog',
    'acp.showTraffic',
    'acp.setMode',
    'acp.setModel',
  ]);

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
    private readonly sessionUpdateHandler: SessionUpdateHandler,
  ) {
    // Register as a session update listener
    this.updateListener = (update: BridgeSessionNotification) => {
      this.handleSessionUpdate(update);
    };
    this.sessionUpdateHandler.addListener(this.updateListener);

    // Sync turnInProgress context with active session state
    this.sessionManager.on('busy-changed', (sessionId, busy) => {
      if (sessionId === this.sessionManager.getActiveSessionId()) {
        void vscode.commands.executeCommand('setContext', 'acp.turnInProgress', busy);
      }
    });
    this.sessionManager.on('active-session-changed', (sessionId) => {
      const busy = sessionId ? this.sessionManager.getSession(sessionId)?.busy ?? false : false;
      void vscode.commands.executeCommand('setContext', 'acp.turnInProgress', busy);
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = getChatWebviewHtml({
      webview: webviewView.webview,
      extensionUri: this.extensionUri,
      devServerUrl: process.env.ACP_WEBVIEW_DEV_SERVER,
    });

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isWebviewToExtensionMessage(message)) {
        logError('Rejected invalid webview message', new Error(safeStringify(message)));
        return;
      }
      await this.handleWebviewMessage(message);
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  private async handleWebviewMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case 'sendPrompt':
        await this.handleSendPrompt(message.text);
        break;
      case 'stateSync':
        this.syncedTimelineSessionId = message.activeSessionId;
        this.syncedHasChatContent = message.hasChatContent;
        break;
      case 'cancelTurn':
        await this.handleCancelTurn();
        break;
      case 'setMode':
        await this.handleSetMode(message.modeId);
        break;
      case 'setModel':
        await this.handleSetModel(message.modelId);
        break;
      case 'executeCommand':
        await this.handleExecuteCommand(message.command);
        break;
      case 'ready':
        this.sendCurrentState();
        break;
      case 'clearError':
        break;
    }
  }

  private async handleExecuteCommand(command: string): Promise<void> {
    if (!this.allowedCommands.has(command)) {
      this.postMessage({ type: 'error', message: `Command is not allowed: ${command}` });
      return;
    }
    await vscode.commands.executeCommand(command);
  }

  /**
   * Forward session update to webview.
   */
  private handleSessionUpdate(update: BridgeSessionNotification): void {
    // Persist available commands on session state
    const availableCommands = getAvailableCommands(update.update);
    if (availableCommands) {
      const session = this.sessionManager.getSession(update.sessionId);
      if (session) {
        session.availableCommands = availableCommands;
      }
    }

    this.postMessage({
      type: 'sessionUpdate',
      update: update.update,
      sessionId: update.sessionId,
    });
  }

  /**
   * Handle a prompt sent from the webview.
   */
  private async handleSendPrompt(text: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId) {
      this.postMessage({
        type: 'error',
        message: 'No active session. Create a session first.',
      });
      return;
    }

    sendEvent('chat/messageSent', {
      agentName: this.sessionManager.getActiveAgentName() ?? '',
    }, {
      messageLength: text.length,
    });

    // Tell webview we're processing
    this.postMessage({ type: 'promptStart' });

    try {
      const response = await this.sessionManager.sendPrompt(activeId, text);
      this.postMessage({
        type: 'promptEnd',
        stopReason: response.stopReason,
        usage: (response as { usage?: unknown }).usage,
      });
    } catch (e: any) {
      logError('Prompt failed', e);
      this.postMessage({
        type: 'error',
        message: e.message || 'Prompt failed',
      });
      this.postMessage({ type: 'promptEnd', stopReason: 'error' });
    }
  }

  /**
   * Handle cancel request from webview.
   */
  private async handleCancelTurn(): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (activeId) {
      try {
        await this.sessionManager.cancelTurn(activeId);
      } catch (e) {
        logError('Cancel failed', e);
      }
    }
  }

  /**
   * Handle mode change from webview picker.
   */
  private async handleSetMode(modeId: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId || !modeId) { return; }
    try {
      await this.sessionManager.setMode(activeId, modeId);
    } catch (e: any) {
      logError('Failed to set mode', e);
      this.postMessage({ type: 'error', message: `Failed to set mode: ${e.message}` });
    }
  }

  /**
   * Handle model change from webview picker.
   */
  private async handleSetModel(modelId: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId || !modelId) { return; }
    try {
      await this.sessionManager.setModel(activeId, modelId);
    } catch (e: any) {
      logError('Failed to set model', e);
      this.postMessage({ type: 'error', message: `Failed to set model: ${e.message}` });
    }
  }

  /**
   * Send current session state to the webview on load.
   */
  private sendCurrentState(): void {
    const activeId = this.sessionManager.getActiveSessionId();
    const session = activeId ? this.sessionManager.getSession(activeId) : null;
    this.postMessage({
      type: 'state',
      activeSessionId: activeId,
      session: session ? {
        sessionId: session.sessionId,
        agentName: session.agentDisplayName,
        cwd: session.cwd,
        modes: session.modes,
        models: session.models,
        availableCommands: session.availableCommands,
      } : null,
    });
  }

  /**
   * Post a message to the webview if it exists.
   */
  private postMessage(message: ExtensionToWebviewMessage): void {
    this.view?.webview.postMessage(message);
  }

  /**
   * Notify webview of a new active session.
   */
  notifyActiveSessionChanged(): void {
    this.sendCurrentState();
  }

  /**
   * Notify webview of mode state changes.
   */
  notifyModesUpdate(modes: SessionModeState | null): void {
    this.postMessage({ type: 'modesUpdate', modes });
  }

  /**
   * Notify webview of model state changes.
   */
  notifyModelsUpdate(models: SessionModelState | null): void {
    this.postMessage({ type: 'modelsUpdate', models });
  }

  /**
   * Clear the chat history and reset to welcome state.
   * Called when starting a new conversation.
   */
  clearChat(): void {
    this.syncedHasChatContent = false;
    void vscode.commands.executeCommand('setContext', 'acp.turnInProgress', false);
    this.postMessage({ type: 'clearChat' });
  }

  /**
   * Whether the chat has any messages.
   */
  get hasChatContent(): boolean {
    const activeSessionId = this.sessionManager.getActiveSessionId();
    return this.syncedTimelineSessionId === activeSessionId && this.syncedHasChatContent;
  }

  /**
   * Attach a file URI — notify the webview to include it in the next prompt.
   */
  attachFile(uri: vscode.Uri): void {
    if (this.view) {
      this.postMessage({
        type: 'fileAttached',
        file: {
          path: uri.fsPath,
          name: uri.fsPath.split(/[\\/]/).pop() || uri.fsPath,
        },
      });
      this.view.show?.(true);
    }
  }

  dispose(): void {
    this.sessionUpdateHandler.removeListener(this.updateListener);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
