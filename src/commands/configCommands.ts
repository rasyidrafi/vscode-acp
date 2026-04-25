import * as vscode from 'vscode';

import { fetchRegistry, getRegistryHomepage } from '../config/RegistryClient';
import { createAgentConfigFromRegistry } from '../config/AgentConfig';
import type { AgentConfigEntry } from '../config/AgentConfig';
import { sendEvent } from '../utils/TelemetryManager';
import type { CommandServices, AgentCommandTarget } from './types';
import { getAgentName, registerCommand, registerTypedCommand } from './types';

export function registerConfigCommands(services: CommandServices): vscode.Disposable[] {
  return [
    registerAddAgentCommand(services),
    registerRemoveAgentCommand(services),
  ];
}

function registerAddAgentCommand(services: CommandServices): vscode.Disposable {
  return registerCommand('acp.addAgent', async () => {
    const config = vscode.workspace.getConfiguration('acp');
    const agents = {
      ...(config.get<Record<string, AgentConfigEntry>>('agents') || {}),
    };

    const result = await fetchRegistry();
    if (result.status === 'failure') {
      vscode.window.showErrorMessage(`Failed to fetch registry: ${result.errorMessage || 'Unknown error'}`);
      return;
    }

    const items = result.agents
      .filter((agent) => !agents[agent.id])
      .map((agent) => ({ agent, agentConfig: createAgentConfigFromRegistry(agent) }))
      .filter((item): item is typeof item & { agentConfig: AgentConfigEntry } => item.agentConfig !== null)
      .map(({ agent, agentConfig }) => ({
        label: agent.name,
        description: agent.id,
        detail: agent.description || getRegistryHomepage(agent) || '',
        agent,
        agentConfig,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));

    if (items.length === 0) {
      vscode.window.showInformationMessage(
        result.agents.length === 0 ? 'No agents found in registry.' : 'All supported registry agents are already added.',
      );
      return;
    }

    if (result.status === 'stale') {
      void vscode.window.showWarningMessage(
        `Showing cached registry data because refresh failed: ${result.errorMessage || 'Unknown error'}`,
      );
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select an agent from the ACP registry',
      title: 'Add OACP Agent',
    });
    if (!picked) { return; }

    agents[picked.agent.id] = picked.agentConfig;
    await config.update('agents', agents, vscode.ConfigurationTarget.Global);
    services.sessionTreeProvider.refresh();
    vscode.window.showInformationMessage(`Agent "${picked.agent.name}" added.`);
    sendEvent('agent/added', { agentId: picked.agent.id });
  });
}

function registerRemoveAgentCommand(services: CommandServices): vscode.Disposable {
  return registerTypedCommand<[AgentCommandTarget | undefined]>('acp.removeAgent', async (target) => {
    const config = vscode.workspace.getConfiguration('acp');
    const agents = {
      ...(config.get<Record<string, AgentConfigEntry>>('agents') || {}),
    };
    const agentIds = Object.keys(agents);
    if (agentIds.length === 0) {
      vscode.window.showInformationMessage('No agents added.');
      return;
    }

    let agentId = getAgentName(target);
    if (!agentId) {
      const picked = await vscode.window.showQuickPick(agentIds.map((id) => ({
        label: agents[id]?.displayName || id,
        description: id,
        agentId: id,
      })), {
        placeHolder: 'Select agent to remove',
        title: 'Remove OACP Agent',
      });
      agentId = picked?.agentId;
    }
    if (!agentId) { return; }

    const displayName = agents[agentId]?.displayName || agentId;

    const confirm = await vscode.window.showWarningMessage(
      `Remove agent "${displayName}"?`, { modal: true }, 'Remove',
    );
    if (confirm !== 'Remove') { return; }

    if (services.sessionManager.isAgentConnected(agentId)) {
      await services.sessionManager.disconnectAgent(agentId);
    }

    delete agents[agentId];
    await config.update('agents', agents, vscode.ConfigurationTarget.Global);
    services.sessionTreeProvider.refresh();
    vscode.window.showInformationMessage(`Agent "${displayName}" removed.`);
    sendEvent('agent/removed', { agentId });
  });
}
