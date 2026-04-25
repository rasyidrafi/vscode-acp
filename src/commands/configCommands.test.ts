import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  registerCommandMock,
  showInformationMessageMock,
  showErrorMessageMock,
  showWarningMessageMock,
  showQuickPickMock,
  settingsUpdateMock,
  sendEventMock,
  fetchRegistryMock,
  createAgentConfigFromRegistryMock,
  isConfigurableAgentMock,
  getAgentSettingsMock,
} = vi.hoisted(() => ({
  registerCommandMock: vi.fn(),
  showInformationMessageMock: vi.fn(),
  showErrorMessageMock: vi.fn(),
  showWarningMessageMock: vi.fn(),
  showQuickPickMock: vi.fn(),
  settingsUpdateMock: vi.fn(),
  sendEventMock: vi.fn(),
  fetchRegistryMock: vi.fn(),
  createAgentConfigFromRegistryMock: vi.fn(),
  isConfigurableAgentMock: vi.fn(),
  getAgentSettingsMock: vi.fn(),
}));

vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1 },
  commands: {
    registerCommand: registerCommandMock,
  },
  window: {
    showInformationMessage: showInformationMessageMock,
    showErrorMessage: showErrorMessageMock,
    showWarningMessage: showWarningMessageMock,
    showQuickPick: showQuickPickMock,
  },
}));

vi.mock('../config/RegistryClient', () => ({
  fetchRegistry: fetchRegistryMock,
  getRegistryHomepage: vi.fn(() => 'https://example.test'),
}));

vi.mock('../config/AgentConfig', () => ({
  createAgentConfigFromRegistry: createAgentConfigFromRegistryMock,
  isConfigurableAgent: isConfigurableAgentMock,
}));

vi.mock('../config/Settings', () => ({
  getSettings: vi.fn(() => ({
    update: settingsUpdateMock,
  })),
  getAgentSettings: getAgentSettingsMock,
}));

vi.mock('../utils/TelemetryManager', () => ({
  sendEvent: sendEventMock,
}));

vi.mock('../utils/commandArgs', () => ({
  parseCommandArgs: vi.fn((value: string) => value.split(/\s+/u).filter(Boolean)),
}));

import { registerConfigCommands } from './configCommands';

type RegisteredCallback = (...args: unknown[]) => unknown;

function createServices() {
  return {
    sessionManager: {
      isAgentConnected: vi.fn(() => false),
      disconnectAgent: vi.fn(),
      connectToAgent: vi.fn(),
    },
    sessionTreeProvider: {
      refresh: vi.fn(),
    },
    chatWebviewProvider: {},
  };
}

function buildCommandMap(): Map<string, RegisteredCallback> {
  const commands = new Map<string, RegisteredCallback>();
  for (const [id, callback] of registerCommandMock.mock.calls as Array<[string, RegisteredCallback]>) {
    commands.set(id, callback);
  }
  return commands;
}

describe('configCommands', () => {
  beforeEach(() => {
    registerCommandMock.mockReset();
    showInformationMessageMock.mockReset();
    showErrorMessageMock.mockReset();
    showWarningMessageMock.mockReset();
    showQuickPickMock.mockReset();
    settingsUpdateMock.mockReset();
    sendEventMock.mockReset();
    fetchRegistryMock.mockReset();
    createAgentConfigFromRegistryMock.mockReset();
    isConfigurableAgentMock.mockReset();
    getAgentSettingsMock.mockReset();

    getAgentSettingsMock.mockReturnValue({});
    isConfigurableAgentMock.mockReturnValue(true);
  });

  it('registers add/edit/remove commands', () => {
    registerConfigCommands(createServices() as never);
    const commandIds = (registerCommandMock.mock.calls as Array<[string]>).map(([id]) => id);
    expect(commandIds).toEqual(expect.arrayContaining(['acp.addAgent', 'acp.editAgent', 'acp.removeAgent']));
  });

  it('addAgent shows error when registry fetch fails', async () => {
    fetchRegistryMock.mockResolvedValue({ status: 'failure', errorMessage: 'network down' });
    registerConfigCommands(createServices() as never);
    const commands = buildCommandMap();

    await commands.get('acp.addAgent')?.();

    expect(showErrorMessageMock).toHaveBeenCalledWith('Failed to fetch registry: network down');
  });

  it('addAgent informs when all supported agents are already added', async () => {
    getAgentSettingsMock.mockReturnValue({
      codex: { command: 'npx', args: ['codex'] },
    });
    fetchRegistryMock.mockResolvedValue({
      status: 'success',
      agents: [{ id: 'codex', name: 'Codex', description: 'Agent' }],
    });
    createAgentConfigFromRegistryMock.mockReturnValue({ command: 'npx', args: ['codex'] });
    registerConfigCommands(createServices() as never);
    const commands = buildCommandMap();

    await commands.get('acp.addAgent')?.();

    expect(showInformationMessageMock).toHaveBeenCalledWith('All supported registry agents are already added.');
  });

  it('addAgent persists selected registry agent and refreshes tree', async () => {
    const services = createServices();
    fetchRegistryMock.mockResolvedValue({
      status: 'success',
      agents: [{ id: 'codex', name: 'Codex', description: 'Agent' }],
    });
    createAgentConfigFromRegistryMock.mockReturnValue({ command: 'npx', args: ['codex'] });
    showQuickPickMock.mockResolvedValue({
      agent: { id: 'codex', name: 'Codex' },
      agentConfig: { command: 'npx', args: ['codex'] },
    });

    registerConfigCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.addAgent')?.();

    expect(settingsUpdateMock).toHaveBeenCalled();
    expect(services.sessionTreeProvider.refresh).toHaveBeenCalled();
    expect(sendEventMock).toHaveBeenCalledWith('agent/added', { agentId: 'codex' });
  });

  it('editAgent shows info when there are no editable agents', async () => {
    getAgentSettingsMock.mockReturnValue({});
    registerConfigCommands(createServices() as never);
    const commands = buildCommandMap();

    await commands.get('acp.editAgent')?.();

    expect(showInformationMessageMock).toHaveBeenCalledWith('No editable agents available.');
  });

  it('removeAgent shows info when there are no agents', async () => {
    getAgentSettingsMock.mockReturnValue({});
    registerConfigCommands(createServices() as never);
    const commands = buildCommandMap();

    await commands.get('acp.removeAgent')?.();

    expect(showInformationMessageMock).toHaveBeenCalledWith('No agents added.');
  });

  it('removeAgent removes selected agent after confirmation', async () => {
    const services = createServices();
    getAgentSettingsMock.mockReturnValue({
      codex: { displayName: 'Codex', command: 'npx', args: ['codex'] },
    });
    showQuickPickMock.mockResolvedValue({ agentId: 'codex', label: 'Codex', description: 'codex' });
    showWarningMessageMock.mockResolvedValue('Remove');

    registerConfigCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.removeAgent')?.();

    expect(settingsUpdateMock).toHaveBeenCalled();
    expect(services.sessionTreeProvider.refresh).toHaveBeenCalled();
    expect(sendEventMock).toHaveBeenCalledWith('agent/removed', { agentId: 'codex' });
  });
});
