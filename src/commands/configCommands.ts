import * as vscode from 'vscode';

import { fetchRegistry, getRegistryHomepage } from '../config/RegistryClient';
import { createAgentConfigFromRegistry, isConfigurableAgent } from '../config/AgentConfig';
import type { AgentConfigEntry } from '../config/AgentConfig';
import { getAgentSettings, getSettings } from '../config/Settings';
import { sendEvent } from '../utils/TelemetryManager';
import { parseCommandArgs } from '../utils/commandArgs';
import type { CommandServices, AgentCommandTarget } from './types';
import { getAgentName, registerCommand, registerTypedCommand } from './types';

export function registerConfigCommands(services: CommandServices): vscode.Disposable[] {
  return [
    registerAddAgentCommand(services),
    registerEditAgentCommand(services),
    registerRemoveAgentCommand(services),
  ];
}

function registerAddAgentCommand(services: CommandServices): vscode.Disposable {
  return registerCommand('acp.addAgent', async () => {
    const config = getSettings();
    const agents = {
      ...(getAgentSettings() as Record<string, AgentConfigEntry>),
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

function registerEditAgentCommand(services: CommandServices): vscode.Disposable {
  return registerTypedCommand<[AgentCommandTarget | undefined]>('acp.editAgent', async (target) => {
    const config = getSettings();
    const agents = {
      ...(getAgentSettings() as Record<string, AgentConfigEntry>),
    };

    let agentId = getAgentName(target);
    if (!agentId) {
      const configurableAgents = Object.entries(agents)
        .filter(([id]) => isConfigurableAgent(id))
        .map(([id, agent]) => ({
          label: agent.displayName || id,
          description: id,
          agentId: id,
        }));
      const picked = await vscode.window.showQuickPick(configurableAgents, {
        placeHolder: 'Select agent to edit',
        title: 'Edit OACP Agent Configuration',
      });
      agentId = picked?.agentId;
    }
    if (!agentId) { return; }

    if (!isConfigurableAgent(agentId)) {
      vscode.window.showInformationMessage('This agent does not expose editable local launch settings yet.');
      return;
    }

    const current = agents[agentId];
    if (!current) {
      vscode.window.showErrorMessage(`Agent "${agentId}" is not added.`);
      return;
    }

    const updated = await editAgentConfig(agentId, current);
    if (!updated) { return; }

    agents[agentId] = updated;
    await config.update('agents', agents, vscode.ConfigurationTarget.Global);
    services.sessionTreeProvider.refresh();

    const displayName = updated.displayName || agentId;
    if (services.sessionManager.isAgentConnected(agentId)) {
      const restart = await vscode.window.showInformationMessage(
        `Updated "${displayName}". Restart the agent to apply launch changes.`,
        'Restart Agent',
      );
      if (restart === 'Restart Agent') {
        await services.sessionManager.disconnectAgent(agentId);
        await services.sessionManager.connectToAgent(agentId);
      }
    } else {
      vscode.window.showInformationMessage(`Updated "${displayName}".`);
    }
    sendEvent('agent/edited', { agentId });
  });
}

type EditField =
  | 'binaryPath'
  | 'binaryName'
  | 'binaryArgs'
  | 'command'
  | 'args'
  | 'env'
  | 'done';

async function editAgentConfig(agentId: string, config: AgentConfigEntry): Promise<AgentConfigEntry | null> {
  let next: AgentConfigEntry = { ...config };

  while (true) {
    const picked = await vscode.window.showQuickPick([
      {
        label: 'Binary Path',
        description: next.binaryPath || 'Use binary name from PATH',
        detail: 'Absolute path to a local CLI binary. Takes priority when set.',
        field: 'binaryPath' as const,
      },
      {
        label: 'Binary Name',
        description: next.binaryName || 'Not set',
        detail: 'Binary name resolved from PATH when binary path is empty.',
        field: 'binaryName' as const,
      },
      {
        label: 'Binary Arguments',
        description: argsToInput(next.binaryArgs),
        detail: 'Arguments passed to binary path/name launch.',
        field: 'binaryArgs' as const,
      },
      {
        label: 'Fallback Command',
        description: next.command || 'Not set',
        detail: 'Fallback command used when no local binary path/name resolves.',
        field: 'command' as const,
      },
      {
        label: 'Fallback Arguments',
        description: argsToInput(next.args),
        detail: 'Arguments passed to fallback command.',
        field: 'args' as const,
      },
      {
        label: 'Environment Variables',
        description: next.env ? `${Object.keys(next.env).length} set` : 'None',
        detail: 'JSON object of string environment variables.',
        field: 'env' as const,
      },
      {
        label: 'Done',
        description: 'Save changes',
        field: 'done' as const,
      },
    ], {
      title: `Edit ${next.displayName || agentId}`,
      placeHolder: 'Choose a launch setting to edit',
    });

    if (!picked) {
      return null;
    }
    if (picked.field === 'done') {
      return cleanAgentConfig(next);
    }

    const edited = await editAgentField(picked.field, next);
    if (!edited) {
      return null;
    }
    next = edited;
  }
}

async function editAgentField(field: Exclude<EditField, 'done'>, config: AgentConfigEntry): Promise<AgentConfigEntry | null> {
  switch (field) {
    case 'binaryPath': {
      const value = await vscode.window.showInputBox({
        title: 'Binary Path',
        prompt: 'Absolute path to a local binary. Leave empty to use Binary Name from PATH.',
        value: config.binaryPath || '',
        placeHolder: '/usr/local/bin/gemini',
      });
      if (value === undefined) { return null; }
      return { ...config, binaryPath: value.trim() || undefined };
    }
    case 'binaryName': {
      const value = await vscode.window.showInputBox({
        title: 'Binary Name',
        prompt: 'Binary name to resolve from PATH. Leave empty to skip local binary resolution.',
        value: config.binaryName || '',
        placeHolder: 'gemini',
      });
      if (value === undefined) { return null; }
      return { ...config, binaryName: value.trim() || undefined };
    }
    case 'binaryArgs': {
      const value = await vscode.window.showInputBox({
        title: 'Binary Arguments',
        prompt: 'Arguments for the local binary launch. Shell-style quotes are supported.',
        value: argsToInput(config.binaryArgs),
        placeHolder: '--acp',
      });
      if (value === undefined) { return null; }
      return { ...config, binaryArgs: parseCommandArgs(value) };
    }
    case 'command': {
      const value = await vscode.window.showInputBox({
        title: 'Fallback Command',
        prompt: 'Fallback command used when local binary path/name is not available.',
        value: config.command,
        placeHolder: 'npx',
        validateInput: (input) => input.trim() ? undefined : 'Fallback command cannot be empty.',
      });
      if (value === undefined) { return null; }
      return { ...config, command: value.trim() };
    }
    case 'args': {
      const value = await vscode.window.showInputBox({
        title: 'Fallback Arguments',
        prompt: 'Arguments for the fallback command. Shell-style quotes are supported.',
        value: argsToInput(config.args),
        placeHolder: '@google/gemini-cli@latest --acp',
      });
      if (value === undefined) { return null; }
      return { ...config, args: parseCommandArgs(value) };
    }
    case 'env': {
      const value = await vscode.window.showInputBox({
        title: 'Environment Variables',
        prompt: 'JSON object of string environment variables. Leave empty for none.',
        value: config.env ? JSON.stringify(config.env) : '',
        placeHolder: '{"FOO":"bar"}',
        validateInput: validateEnvInput,
      });
      if (value === undefined) { return null; }
      return { ...config, env: parseEnvInput(value) };
    }
  }
}

function cleanAgentConfig(config: AgentConfigEntry): AgentConfigEntry {
  return {
    command: config.command,
    ...(config.id ? { id: config.id } : {}),
    ...(config.displayName ? { displayName: config.displayName } : {}),
    ...(config.registryVersion ? { registryVersion: config.registryVersion } : {}),
    ...(config.binaryPath ? { binaryPath: config.binaryPath } : {}),
    ...(config.binaryName ? { binaryName: config.binaryName } : {}),
    ...(config.binaryArgs && config.binaryArgs.length > 0 ? { binaryArgs: config.binaryArgs } : {}),
    ...(config.args && config.args.length > 0 ? { args: config.args } : {}),
    ...(config.env && Object.keys(config.env).length > 0 ? { env: config.env } : {}),
  };
}

function argsToInput(args: string[] | undefined): string {
  return (args || []).map(quoteArg).join(' ');
}

function quoteArg(arg: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/u.test(arg)
    ? arg
    : `"${arg.replace(/(["\\$`])/gu, '\\$1')}"`;
}

function validateEnvInput(input: string): string | undefined {
  if (!input.trim()) {
    return undefined;
  }
  try {
    parseEnvInput(input);
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function parseEnvInput(input: string): Record<string, string> | undefined {
  if (!input.trim()) {
    return undefined;
  }
  const parsed = JSON.parse(input) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Environment must be a JSON object.');
  }
  const entries = Object.entries(parsed);
  const invalid = entries.find((entry) => typeof entry[1] !== 'string');
  if (invalid) {
    throw new Error(`Environment value for "${invalid[0]}" must be a string.`);
  }
  return Object.fromEntries(entries as Array<[string, string]>);
}

function registerRemoveAgentCommand(services: CommandServices): vscode.Disposable {
  return registerTypedCommand<[AgentCommandTarget | undefined]>('acp.removeAgent', async (target) => {
    const config = getSettings();
    const agents = {
      ...(getAgentSettings() as Record<string, AgentConfigEntry>),
    };
    const agentIds = Object.keys(agents);
    if (agentIds.length === 0) {
      vscode.window.showInformationMessage('No agents added.');
      return;
    }

    let agentId = getAgentName(target);
    if (!agentId) {
      const picked = await vscode.window.showQuickPick(agentIds
        .map((id) => ({
          label: agents[id]?.displayName || id,
          description: id,
          agentId: id,
        }))
        .sort((left, right) => left.label.localeCompare(right.label)), {
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
