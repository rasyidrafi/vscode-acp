import * as vscode from 'vscode';

import { getOutputChannel, getTrafficChannel, logError } from '../utils/Logger';
import { sendEvent } from '../utils/TelemetryManager';
import type { CommandServices, AgentCommandTarget } from './types';
import { getAgentName, registerCommand, registerTypedCommand } from './types';
import { getAgentNames } from '../config/AgentConfig';

export function registerSessionCommands(services: CommandServices): vscode.Disposable[] {
  return [
    registerConnectAgentCommand(services),
    registerNewConversationCommand(services),
    registerDisconnectAgentCommand(services),
    registerOpenChatCommand(),
    registerSendPromptCommand(),
    registerCancelTurnCommand(services),
    registerRestartAgentCommand(services),
    registerShowLogCommand(),
    registerShowTrafficCommand(),
    registerSetModeCommand(services),
    registerSetModelCommand(services),
    registerRefreshAgentsCommand(services),
    registerOpenSettingsCommand(),
    registerAttachFileCommand(services),
  ];
}

function registerConnectAgentCommand(services: CommandServices): vscode.Disposable {
  return registerTypedCommand<[string | AgentCommandTarget | undefined]>('acp.connectAgent', async (target) => {
    let agentName = getAgentName(target);

    if (!agentName) {
      const agentNames = getAgentNames();
      if (agentNames.length === 0) {
        vscode.window.showWarningMessage(
          'No ACP agents configured. Add agents in Settings > ACP > Agents.',
        );
        return;
      }
      agentName = await vscode.window.showQuickPick(agentNames, {
        placeHolder: 'Select an agent to connect',
        title: 'Connect to Agent',
      });
      if (!agentName) { return; }
    }

    const currentAgent = services.sessionManager.getActiveAgentName();
    if (currentAgent && currentAgent === agentName) {
      void vscode.commands.executeCommand('acp-chat.focus');
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Connecting to ${agentName}...`,
          cancellable: false,
        },
        async () => {
          await services.sessionManager.connectToAgent(agentName!);
        },
      );
    } catch (e: unknown) {
      logError('Failed to connect to agent', e);
      const message = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Failed to connect: ${message}`);
    }
  });
}

function registerNewConversationCommand(services: CommandServices): vscode.Disposable {
  return registerCommand('acp.newConversation', async () => {
    const activeSession = services.sessionManager.getActiveSession();
    if (!activeSession) {
      await vscode.commands.executeCommand('acp.connectAgent');
      return;
    }

    if (services.chatWebviewProvider.hasChatContent) {
      const choice = await vscode.window.showWarningMessage(
        'Start a new conversation? This will clear the current chat history.',
        'New Conversation',
        'Cancel',
      );
      if (choice !== 'New Conversation') { return; }
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
    } catch (e: unknown) {
      logError('Failed to start new conversation', e);
      const message = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Failed to start new conversation: ${message}`);
    }
  });
}

function registerDisconnectAgentCommand(services: CommandServices): vscode.Disposable {
  return registerTypedCommand<[AgentCommandTarget | undefined]>('acp.disconnectAgent', async (target) => {
    const agentName = getAgentName(target) || services.sessionManager.getActiveAgentName();
    if (!agentName) {
      vscode.window.showInformationMessage('No agent connected.');
      return;
    }
    await services.sessionManager.disconnectAgent(agentName);
    vscode.window.showInformationMessage(`Disconnected from ${agentName}.`);
  });
}

function registerOpenChatCommand(): vscode.Disposable {
  return registerCommand('acp.openChat', () => {
    void vscode.commands.executeCommand('acp-chat.focus');
  });
}

function registerSendPromptCommand(): vscode.Disposable {
  return registerCommand('acp.sendPrompt', () => {
    void vscode.commands.executeCommand('acp-chat.focus');
  });
}

function registerCancelTurnCommand(services: CommandServices): vscode.Disposable {
  return registerCommand('acp.cancelTurn', async () => {
    const activeId = services.sessionManager.getActiveSessionId();
    if (!activeId) {
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
    const activeSession = services.sessionManager.getActiveSession();
    if (!activeSession) { return; }

    const agentName = activeSession.agentName;
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Restarting ${activeSession.agentDisplayName}...`,
          cancellable: false,
        },
        async () => {
          await services.sessionManager.disconnectAgent(agentName);
          await services.sessionManager.connectToAgent(agentName);
        },
      );
      vscode.window.showInformationMessage(`Restarted ${agentName}`);
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
    if (!activeId) { return; }

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
    if (!activeId) { return; }

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

function registerRefreshAgentsCommand(services: CommandServices): vscode.Disposable {
  return registerCommand('acp.refreshAgents', () => {
    services.sessionTreeProvider.refresh();
  });
}

function registerOpenSettingsCommand(): vscode.Disposable {
  return registerCommand('acp.openSettings', async () => {
    sendEvent('command/openSettings');
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      '@ext:formulahendry.acp-client',
    );
  });
}

function registerAttachFileCommand(services: CommandServices): vscode.Disposable {
  return registerCommand('acp.attachFile', async () => {
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
