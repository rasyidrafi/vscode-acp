import * as vscode from 'vscode';

import { fetchRegistry } from '../config/RegistryClient';
import type { AgentConfigEntry } from '../config/AgentConfig';
import { sendEvent } from '../utils/TelemetryManager';
import type { CommandServices, AgentCommandTarget } from './types';
import { getAgentName, registerCommand, registerTypedCommand } from './types';

export function registerConfigCommands(services: CommandServices): vscode.Disposable[] {
  return [
    registerAddAgentCommand(services),
    registerRemoveAgentCommand(services),
    registerBrowseRegistryCommand(),
  ];
}

function registerAddAgentCommand(services: CommandServices): vscode.Disposable {
  return registerCommand('acp.addAgent', async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Agent name',
      placeHolder: 'my-agent',
      title: 'Add ACP Agent',
    });
    if (!name) { return; }

    const command = await vscode.window.showInputBox({
      prompt: 'Command to launch the agent',
      placeHolder: 'npx',
      title: 'Agent Command',
    });
    if (!command) { return; }

    const argsStr = await vscode.window.showInputBox({
      prompt: 'Arguments (space-separated)',
      placeHolder: '-y @my-org/agent',
      title: 'Agent Arguments',
    });
    const args = argsStr ? argsStr.split(/\s+/) : [];

    const config = vscode.workspace.getConfiguration('acp');
    const agents = {
      ...(config.get<Record<string, AgentConfigEntry>>('agents') || {}),
    };
    agents[name] = { command, args };
    await config.update('agents', agents, vscode.ConfigurationTarget.Global);
    services.sessionTreeProvider.refresh();
    vscode.window.showInformationMessage(`Agent "${name}" added.`);
    sendEvent('agent/added');
  });
}

function registerRemoveAgentCommand(services: CommandServices): vscode.Disposable {
  return registerTypedCommand<[AgentCommandTarget | undefined]>('acp.removeAgent', async (target) => {
    const config = vscode.workspace.getConfiguration('acp');
    const agents = {
      ...(config.get<Record<string, AgentConfigEntry>>('agents') || {}),
    };
    const agentNames = Object.keys(agents);
    if (agentNames.length === 0) {
      vscode.window.showInformationMessage('No agents configured.');
      return;
    }

    const name = getAgentName(target) ?? await vscode.window.showQuickPick(agentNames, {
      placeHolder: 'Select agent to remove',
      title: 'Remove ACP Agent',
    });
    if (!name) { return; }

    const confirm = await vscode.window.showWarningMessage(
      `Remove agent "${name}"?`, { modal: true }, 'Remove',
    );
    if (confirm !== 'Remove') { return; }

    if (services.sessionManager.isAgentConnected(name)) {
      await services.sessionManager.disconnectAgent(name);
    }

    delete agents[name];
    await config.update('agents', agents, vscode.ConfigurationTarget.Global);
    services.sessionTreeProvider.refresh();
    vscode.window.showInformationMessage(`Agent "${name}" removed.`);
    sendEvent('agent/removed', { agentName: name });
  });
}

function registerBrowseRegistryCommand(): vscode.Disposable {
  return registerCommand('acp.browseRegistry', async () => {
    sendEvent('registry/browse');
    try {
      const agents = await fetchRegistry();
      const items = agents.map((agent) => ({
        label: agent.name,
        description: agent.command,
        detail: agent.description || '',
      }));

      if (items.length === 0) {
        vscode.window.showInformationMessage('No agents found in registry.');
        return;
      }

      await vscode.window.showQuickPick(items, {
        placeHolder: 'ACP Agent Registry',
        title: 'Available ACP Agents',
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Failed to fetch registry: ${message}`);
    }
  });
}
