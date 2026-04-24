import * as vscode from 'vscode';

import { AgentManager } from './core/AgentManager';
import { ConnectionManager } from './core/ConnectionManager';
import { SessionManager } from './core/SessionManager';
import { SessionUpdateHandler } from './handlers/SessionUpdateHandler';
import { SessionTreeProvider } from './ui/SessionTreeProvider';
import { StatusBarManager } from './ui/StatusBarManager';
import { ChatWebviewProvider } from './ui/ChatWebviewProvider';
import { registerCommands } from './commands';
import { log, disposeChannels } from './utils/Logger';
import { initTelemetry, sendEvent } from './utils/TelemetryManager';

export function activate(context: vscode.ExtensionContext): void {
  log('ACP Client extension activating...');

  // --- Telemetry ---
  const telemetryReporter = initTelemetry();
  context.subscriptions.push(telemetryReporter);

  // --- Core services ---
  const sessionUpdateHandler = new SessionUpdateHandler();
  const agentManager = new AgentManager();
  const connectionManager = new ConnectionManager(sessionUpdateHandler);
  const sessionManager = new SessionManager(
    agentManager,
    connectionManager,
    sessionUpdateHandler,
  );

  // --- UI ---
  const sessionTreeProvider = new SessionTreeProvider(sessionManager);
  const treeView = vscode.window.createTreeView('acp-sessions', {
    treeDataProvider: sessionTreeProvider,
  });

  const chatWebviewProvider = new ChatWebviewProvider(
    context.extensionUri,
    sessionManager,
    sessionUpdateHandler,
  );
  const chatViewRegistration = vscode.window.registerWebviewViewProvider(
    ChatWebviewProvider.viewType,
    chatWebviewProvider,
  );

  const statusBarManager = new StatusBarManager(sessionManager);

  // Notify chat webview when active session changes
  sessionManager.on('active-session-changed', () => {
    chatWebviewProvider.notifyActiveSessionChanged();
  });

  // Clear chat when new conversation is started
  sessionManager.on('clear-chat', () => {
    chatWebviewProvider.clearChat();
  });

  // Forward mode/model changes to webview
  sessionManager.on('mode-changed', (_sessionId: string, _modeId: string) => {
    const session = sessionManager.getActiveSession();
    if (session?.modes) {
      chatWebviewProvider.notifyModesUpdate(session.modes);
    }
  });

  sessionManager.on('model-changed', (_sessionId: string, _modelId: string) => {
    const session = sessionManager.getActiveSession();
    if (session?.models) {
      chatWebviewProvider.notifyModelsUpdate(session.models);
    }
  });

  const commandDisposables = registerCommands({
    sessionManager,
    sessionTreeProvider,
    chatWebviewProvider,
  });

  // --- Register disposables ---
  context.subscriptions.push(
    treeView,
    chatViewRegistration,
    statusBarManager,
    ...commandDisposables,
    {
      dispose: () => {
        sessionManager.dispose();
        sessionUpdateHandler.dispose();
        chatWebviewProvider.dispose();
        sessionTreeProvider.dispose();
        disposeChannels();
      },
    },
  );

  sendEvent('extension/activated', { version: vscode.extensions.getExtension('formulahendry.acp-client')?.packageJSON?.version ?? 'unknown' });
  log('ACP Client extension activated.');
}

export function deactivate(): void {
  log('ACP Client extension deactivated.');
}
