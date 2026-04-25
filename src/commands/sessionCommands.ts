import * as vscode from 'vscode';

import { getOutputChannel, getTrafficChannel, logError } from '../utils/Logger';
import { sendEvent } from '../utils/TelemetryManager';
import type { CommandServices, AgentCommandTarget } from './types';
import { getAgentName, getSessionId, registerCommand, registerTypedCommand } from './types';
import { getAgentDisplayName, getAgentQuickPickItems } from '../config/AgentConfig';
import { getShortSessionId } from '../shared/sessionDisplay';

const NO_ACTIVE_SESSION_MESSAGE = 'No active session instance. Create or open a session first.';

function getConnectedAgentQuickPickItems(agentNames: string[]): Array<vscode.QuickPickItem & { agentName: string }> {
  return agentNames
    .map((name) => ({
      label: getAgentDisplayName(name),
      description: name,
      agentName: name,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function getSessionQuickPickItems(
  services: CommandServices,
): Array<vscode.QuickPickItem & { sessionId: string }> {
  const activeSessionId = services.sessionManager.getActiveSessionId();
  return services.sessionManager
    .getSessions()
    .map((session) => ({
      label: `${session.agentDisplayName} session ${getShortSessionId(session.sessionId)}`,
      description: session.sessionId === activeSessionId ? `${session.sessionId} (active)` : session.sessionId,
      sessionId: session.sessionId,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function registerSessionCommands(services: CommandServices): vscode.Disposable[] {
  return [
    registerConnectAgentCommand(services),
    registerOpenSessionCommand(services),
    registerNewConversationCommand(services),
    registerDisconnectSessionCommand(services),
    registerDisconnectActiveSessionCommand(services),
    registerDisconnectAgentCommand(services),
    registerOpenChatCommand(),
    registerSendPromptCommand(services),
    registerCancelTurnCommand(services),
    registerRestartAgentCommand(services),
    registerShowLogCommand(),
    registerShowTrafficCommand(),
    registerSetModeCommand(services),
    registerSetModelCommand(services),
    registerOpenSettingsCommand(),
    registerAttachFileCommand(services),
  ];
}

function registerConnectAgentCommand(services: CommandServices): vscode.Disposable {
  return registerTypedCommand<[string | AgentCommandTarget | undefined]>('acp.connectAgent', async (target) => {
    let agentName = getAgentName(target);

    if (!agentName) {
      const agentItems = getAgentQuickPickItems();
      if (agentItems.length === 0) {
        vscode.window.showInformationMessage(
          'No ACP agents added. Use Add Agent to select one from the ACP registry.',
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(agentItems, {
        placeHolder: 'Select an agent to create a session instance',
        title: 'Create Agent Instance',
      });
      agentName = picked?.agentId;
      if (!agentName) { return; }
    }

    const agentDisplayName = getAgentDisplayName(agentName);

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Creating ${agentDisplayName} session...`,
          cancellable: false,
        },
        async () => {
          await services.sessionManager.createSessionInstance(agentName!);
        },
      );
      void vscode.commands.executeCommand('acp-chat.focus');
    } catch (e: unknown) {
      logError('Failed to connect to agent', e);
      const message = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Failed to create session: ${message}`);
    }
  });
}

function registerOpenSessionCommand(services: CommandServices): vscode.Disposable {
  return registerTypedCommand<[string | AgentCommandTarget | undefined]>('acp.openSession', async (target) => {
    let sessionId = getSessionId(target);
    if (!sessionId) {
      const sessionItems = getSessionQuickPickItems(services);
      if (sessionItems.length === 0) {
        vscode.window.showInformationMessage('No session instance connected.');
        return;
      }

      const picked = await vscode.window.showQuickPick(sessionItems, {
        placeHolder: 'Select a session instance to open',
        title: 'Open Session Instance',
      });
      sessionId = picked?.sessionId;
    }

    if (!sessionId) {
      return;
    }

    const session = services.sessionManager.openSession(sessionId);
    if (!session) {
      vscode.window.showWarningMessage('Session is no longer connected.');
      return;
    }

    void vscode.commands.executeCommand('acp-chat.focus');
  });
}

function registerNewConversationCommand(services: CommandServices): vscode.Disposable {
  return registerCommand('acp.newConversation', async () => {
    const activeSession = services.sessionManager.getActiveSession();
    if (!activeSession) {
      await vscode.commands.executeCommand('acp.connectAgent');
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Starting new conversation with ${activeSession.agentDisplayName}...`,
          cancellable: false,
        },
        async () => {
          await services.sessionManager.newConversation();
        },
      );
      void vscode.commands.executeCommand('acp-chat.focus');
    } catch (e: unknown) {
      logError('Failed to start new conversation', e);
      const message = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Failed to start new conversation: ${message}`);
    }
  });
}

function registerDisconnectAgentCommand(services: CommandServices): vscode.Disposable {
  return registerTypedCommand<[AgentCommandTarget | undefined]>('acp.disconnectAgent', async (target) => {
    let agentName = getAgentName(target);

    if (!agentName) {
      const connectedAgentNames = services.sessionManager.getConnectedAgentNames();
      if (connectedAgentNames.length === 0) {
        vscode.window.showInformationMessage('No agent connected.');
        return;
      }

      const picked = await vscode.window.showQuickPick(getConnectedAgentQuickPickItems(connectedAgentNames), {
        placeHolder: 'Select connected agent to disconnect',
        title: 'Disconnect OACP Agent',
      });
      agentName = picked?.agentName;
    }

    if (!agentName) {
      return;
    }

    if (!services.sessionManager.isAgentConnected(agentName)) {
      vscode.window.showInformationMessage(`Agent "${getAgentDisplayName(agentName)}" is not connected.`);
      return;
    }

    await services.sessionManager.disconnectAgent(agentName);
    vscode.window.showInformationMessage(`Disconnected from ${getAgentDisplayName(agentName)}.`);
  });
}

function registerDisconnectSessionCommand(services: CommandServices): vscode.Disposable {
  return registerTypedCommand<[string | AgentCommandTarget | undefined]>('acp.disconnectSession', async (target) => {
    let sessionId = getSessionId(target);
    if (!sessionId) {
      const sessionItems = getSessionQuickPickItems(services);
      if (sessionItems.length === 0) {
        vscode.window.showInformationMessage('No session instance connected.');
        return;
      }

      const picked = await vscode.window.showQuickPick(sessionItems, {
        placeHolder: 'Select a session instance to disconnect',
        title: 'Disconnect Session Instance',
      });
      sessionId = picked?.sessionId;
    }

    if (!sessionId) {
      return;
    }

    const session = services.sessionManager.getSession(sessionId);
    if (!session) {
      vscode.window.showInformationMessage('Session is no longer connected.');
      return;
    }

    await services.sessionManager.disconnectSession(sessionId);
    vscode.window.showInformationMessage(
      `Disconnected ${session.agentDisplayName} session.`,
    );
  });
}

function registerDisconnectActiveSessionCommand(services: CommandServices): vscode.Disposable {
  return registerCommand('acp.disconnectActiveSession', async () => {
    const activeSessionId = services.sessionManager.getActiveSessionId();
    if (!activeSessionId) {
      vscode.window.showInformationMessage('No active session instance. Create or open a session first.');
      return;
    }

    const session = services.sessionManager.getSession(activeSessionId);
    if (!session) {
      vscode.window.showInformationMessage('Session is no longer connected.');
      return;
    }

    await services.sessionManager.disconnectSession(activeSessionId);
    vscode.window.showInformationMessage(`Disconnected ${session.agentDisplayName} session.`);
  });
}

function registerOpenChatCommand(): vscode.Disposable {
  return registerCommand('acp.openChat', () => {
    void vscode.commands.executeCommand('acp-chat.focus');
  });
}

function registerSendPromptCommand(services: CommandServices): vscode.Disposable {
  return registerCommand('acp.sendPrompt', () => {
    const activeSessionId = services.sessionManager.getActiveSessionId();
    if (!activeSessionId) {
      vscode.window.showInformationMessage(NO_ACTIVE_SESSION_MESSAGE);
      return;
    }
    services.chatWebviewProvider.requestSendPrompt();
  });
}

function registerCancelTurnCommand(services: CommandServices): vscode.Disposable {
  return registerCommand('acp.cancelTurn', async () => {
    const activeId = services.sessionManager.getActiveSessionId();
    if (!activeId) {
      vscode.window.showInformationMessage(NO_ACTIVE_SESSION_MESSAGE);
      return;
    }
    try {
      await services.sessionManager.cancelTurn(activeId);
    } catch (e) {
      logError('Cancel failed', e);
    }
  });
}

function registerRestartAgentCommand(services: CommandServices): vscode.Disposable {
  return registerCommand('acp.restartAgent', async () => {
    const connectedAgentNames = services.sessionManager.getConnectedAgentNames();
    if (connectedAgentNames.length === 0) {
      vscode.window.showInformationMessage('No agent connected.');
      return;
    }

    const picked = await vscode.window.showQuickPick(getConnectedAgentQuickPickItems(connectedAgentNames), {
      placeHolder: 'Select connected agent to restart',
      title: 'Restart OACP Agent',
    });
    const agentName = picked?.agentName;
    if (!agentName) { return; }

    const agentDisplayName = getAgentDisplayName(agentName);
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Restarting ${agentDisplayName}...`,
          cancellable: false,
        },
        async () => {
          await services.sessionManager.disconnectAgent(agentName!);
          await services.sessionManager.connectToAgent(agentName);
        },
      );
      vscode.window.showInformationMessage(`Restarted ${agentDisplayName}.`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Failed to restart: ${message}`);
    }
  });
}

function registerShowLogCommand(): vscode.Disposable {
  return registerCommand('acp.showLog', () => {
    sendEvent('command/showLog');
    getOutputChannel().show();
  });
}

function registerShowTrafficCommand(): vscode.Disposable {
  return registerCommand('acp.showTraffic', () => {
    sendEvent('command/showTraffic');
    getTrafficChannel().show();
  });
}

function registerSetModeCommand(services: CommandServices): vscode.Disposable {
  return registerTypedCommand<[string | undefined]>('acp.setMode', async (modeId) => {
    const activeId = services.sessionManager.getActiveSessionId();
    if (!activeId) {
      vscode.window.showInformationMessage(NO_ACTIVE_SESSION_MESSAGE);
      return;
    }

    let nextModeId = modeId;
    if (!nextModeId) {
      nextModeId = await pickModeId(services);
    }

    if (!nextModeId) { return; }

    try {
      await services.sessionManager.setMode(activeId, nextModeId);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Failed to set mode: ${message}`);
    }
  });
}

function registerSetModelCommand(services: CommandServices): vscode.Disposable {
  return registerTypedCommand<[string | undefined]>('acp.setModel', async (modelId) => {
    const activeId = services.sessionManager.getActiveSessionId();
    if (!activeId) {
      vscode.window.showInformationMessage(NO_ACTIVE_SESSION_MESSAGE);
      return;
    }

    let nextModelId = modelId;
    if (!nextModelId) {
      nextModelId = await pickModelId(services);
    }

    if (!nextModelId) { return; }

    try {
      await services.sessionManager.setModel(activeId, nextModelId);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Failed to set model: ${message}`);
    }
  });
}

function registerOpenSettingsCommand(): vscode.Disposable {
  return registerCommand('acp.openSettings', async () => {
    sendEvent('command/openSettings');
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      '@ext:rasyidrafi.oacp',
    );
  });
}

function registerAttachFileCommand(services: CommandServices): vscode.Disposable {
  return registerCommand('acp.attachFile', async () => {
    const activeSessionId = services.sessionManager.getActiveSessionId();
    if (!activeSessionId) {
      vscode.window.showInformationMessage(NO_ACTIVE_SESSION_MESSAGE);
      return;
    }

    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Attach',
      title: 'Attach File to Chat',
    });
    if (uris && uris.length > 0) {
      services.chatWebviewProvider.attachFile(uris[0]!);
    }
  });
}

async function pickModeId(services: CommandServices): Promise<string | undefined> {
  const session = services.sessionManager.getActiveSession();
  const availableModes = session?.modes?.availableModes ?? [];

  if (availableModes.length > 0) {
    const picked = await vscode.window.showQuickPick([
      ...availableModes.map((mode) => ({
        label: mode.name,
        description: mode.id,
        modeId: mode.id,
      })),
      {
        label: 'Enter mode ID manually',
        description: 'Use a custom mode identifier',
        modeId: '__manual__',
      },
    ], {
      placeHolder: 'Select an agent mode',
      title: 'Set Agent Mode',
    });

    if (!picked) {
      return undefined;
    }
    if (picked.modeId !== '__manual__') {
      return picked.modeId;
    }
  }

  return vscode.window.showInputBox({
    placeHolder: 'Enter mode ID (e.g., "plan", "code")',
    title: 'Set Agent Mode',
  }) || undefined;
}

async function pickModelId(services: CommandServices): Promise<string | undefined> {
  const session = services.sessionManager.getActiveSession();
  const availableModels = session?.models?.availableModels ?? [];

  if (availableModels.length > 0) {
    const picked = await vscode.window.showQuickPick([
      ...availableModels.map((model) => ({
        label: model.name,
        description: model.modelId,
        detail: typeof model.description === 'string' ? model.description : undefined,
        modelId: model.modelId,
      })),
      {
        label: 'Enter model ID manually',
        description: 'Use a custom model identifier',
        modelId: '__manual__',
      },
    ], {
      placeHolder: 'Select an agent model',
      title: 'Set Agent Model',
    });

    if (!picked) {
      return undefined;
    }
    if (picked.modelId !== '__manual__') {
      return picked.modelId;
    }
  }

  return vscode.window.showInputBox({
    placeHolder: 'Enter model ID',
    title: 'Set Agent Model',
  }) || undefined;
}
