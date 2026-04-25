import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  registerCommandMock,
  executeCommandMock,
  showInformationMessageMock,
  showErrorMessageMock,
  showWarningMessageMock,
  showQuickPickMock,
  showInputBoxMock,
  showOpenDialogMock,
  withProgressMock,
  outputShowMock,
  trafficShowMock,
  sendEventMock,
} = vi.hoisted(() => ({
  registerCommandMock: vi.fn(),
  executeCommandMock: vi.fn(),
  showInformationMessageMock: vi.fn(),
  showErrorMessageMock: vi.fn(),
  showWarningMessageMock: vi.fn(),
  showQuickPickMock: vi.fn(),
  showInputBoxMock: vi.fn(),
  showOpenDialogMock: vi.fn(),
  withProgressMock: vi.fn(),
  outputShowMock: vi.fn(),
  trafficShowMock: vi.fn(),
  sendEventMock: vi.fn(),
}));

vi.mock('vscode', () => ({
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1 },
  commands: {
    registerCommand: registerCommandMock,
    executeCommand: executeCommandMock,
  },
  window: {
    showInformationMessage: showInformationMessageMock,
    showErrorMessage: showErrorMessageMock,
    showWarningMessage: showWarningMessageMock,
    showQuickPick: showQuickPickMock,
    showInputBox: showInputBoxMock,
    showOpenDialog: showOpenDialogMock,
    withProgress: withProgressMock,
  },
}));

vi.mock('../config/AgentConfig', () => ({
  getAgentDisplayName: vi.fn((name: string) => name),
  getAgentQuickPickItems: vi.fn(() => [{ label: 'Codex', description: 'Codex', agentId: 'Codex' }]),
}));

vi.mock('../utils/Logger', () => ({
  getOutputChannel: vi.fn(() => ({ show: outputShowMock })),
  getTrafficChannel: vi.fn(() => ({ show: trafficShowMock })),
  logError: vi.fn(),
}));

vi.mock('../utils/TelemetryManager', () => ({
  sendEvent: sendEventMock,
}));

import { registerSessionCommands } from './sessionCommands';

type RegisteredCallback = (...args: unknown[]) => unknown;

function createServices() {
  return {
    sessionManager: {
      getActiveSessionId: vi.fn(() => null),
      getActiveSession: vi.fn(() => null),
      getSessions: vi.fn(() => []),
      getSession: vi.fn(),
      getConnectedAgentNames: vi.fn(() => []),
      getActiveAgentName: vi.fn(() => null),
      isAgentConnected: vi.fn(() => false),
      createSessionInstance: vi.fn(),
      openSession: vi.fn(),
      newConversation: vi.fn(),
      disconnectAgent: vi.fn(),
      disconnectSession: vi.fn(),
      cancelTurn: vi.fn(),
      connectToAgent: vi.fn(),
      setMode: vi.fn(),
      setModel: vi.fn(),
    },
    sessionTreeProvider: {
      refresh: vi.fn(),
    },
    chatWebviewProvider: {
      hasChatContent: false,
      attachFile: vi.fn(),
    },
  };
}

function buildCommandMap(): Map<string, RegisteredCallback> {
  const commands = new Map<string, RegisteredCallback>();
  for (const [id, callback] of registerCommandMock.mock.calls as Array<[string, RegisteredCallback]>) {
    commands.set(id, callback);
  }
  return commands;
}

const noActiveSessionMessage = 'No active session instance. Create or open a session first.';

describe('sessionCommands', () => {
  beforeEach(() => {
    registerCommandMock.mockReset();
    executeCommandMock.mockReset();
    showInformationMessageMock.mockReset();
    showErrorMessageMock.mockReset();
    showWarningMessageMock.mockReset();
    showQuickPickMock.mockReset();
    showInputBoxMock.mockReset();
    showOpenDialogMock.mockReset();
    outputShowMock.mockReset();
    trafficShowMock.mockReset();
    sendEventMock.mockReset();

    withProgressMock.mockReset();
    withProgressMock.mockImplementation(async (_options, task) => task());
  });

  it('registers all session commands', () => {
    registerSessionCommands(createServices() as never);
    const commandIds = (registerCommandMock.mock.calls as Array<[string]>).map(([id]) => id);

    expect(commandIds).toEqual(expect.arrayContaining([
      'acp.connectAgent',
      'acp.openSession',
      'acp.newConversation',
      'acp.disconnectSession',
      'acp.disconnectActiveSession',
      'acp.disconnectAgent',
      'acp.openChat',
      'acp.sendPrompt',
      'acp.cancelTurn',
      'acp.restartAgent',
      'acp.showLog',
      'acp.showTraffic',
      'acp.setMode',
      'acp.setModel',
      'acp.openSettings',
      'acp.attachFile',
    ]));
  });

  it('sendPrompt shows no-active-session info when there is no active session', async () => {
    const services = createServices();
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.sendPrompt')?.();

    expect(showInformationMessageMock).toHaveBeenCalledWith(noActiveSessionMessage);
    expect(executeCommandMock).not.toHaveBeenCalledWith('acp-chat.focus');
  });

  it('sendPrompt focuses chat when active session exists', async () => {
    const services = createServices();
    (services.sessionManager.getActiveSessionId as ReturnType<typeof vi.fn>).mockReturnValue('session-1');
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.sendPrompt')?.();

    expect(executeCommandMock).toHaveBeenCalledWith('acp-chat.focus');
  });

  it('cancelTurn shows no-active-session info and does not cancel', async () => {
    const services = createServices();
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.cancelTurn')?.();

    expect(showInformationMessageMock).toHaveBeenCalledWith(noActiveSessionMessage);
    expect(services.sessionManager.cancelTurn).not.toHaveBeenCalled();
  });

  it('cancelTurn calls sessionManager.cancelTurn for active session', async () => {
    const services = createServices();
    (services.sessionManager.getActiveSessionId as ReturnType<typeof vi.fn>).mockReturnValue('session-1');
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.cancelTurn')?.();

    expect(services.sessionManager.cancelTurn).toHaveBeenCalledWith('session-1');
  });

  it('setMode shows no-active-session info when there is no active session', async () => {
    const services = createServices();
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.setMode')?.();

    expect(showInformationMessageMock).toHaveBeenCalledWith(noActiveSessionMessage);
    expect(services.sessionManager.setMode).not.toHaveBeenCalled();
  });

  it('setMode sets explicit mode when active session exists', async () => {
    const services = createServices();
    (services.sessionManager.getActiveSessionId as ReturnType<typeof vi.fn>).mockReturnValue('session-1');
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.setMode')?.('plan');

    expect(services.sessionManager.setMode).toHaveBeenCalledWith('session-1', 'plan');
  });

  it('setModel shows no-active-session info when there is no active session', async () => {
    const services = createServices();
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.setModel')?.();

    expect(showInformationMessageMock).toHaveBeenCalledWith(noActiveSessionMessage);
    expect(services.sessionManager.setModel).not.toHaveBeenCalled();
  });

  it('setModel sets explicit model when active session exists', async () => {
    const services = createServices();
    (services.sessionManager.getActiveSessionId as ReturnType<typeof vi.fn>).mockReturnValue('session-1');
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.setModel')?.('gpt-5.5');

    expect(services.sessionManager.setModel).toHaveBeenCalledWith('session-1', 'gpt-5.5');
  });

  it('attachFile shows no-active-session info when there is no active session', async () => {
    const services = createServices();
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.attachFile')?.();

    expect(showInformationMessageMock).toHaveBeenCalledWith(noActiveSessionMessage);
    expect(services.chatWebviewProvider.attachFile).not.toHaveBeenCalled();
  });

  it('attachFile forwards selected file to webview when active session exists', async () => {
    const services = createServices();
    (services.sessionManager.getActiveSessionId as ReturnType<typeof vi.fn>).mockReturnValue('session-1');
    showOpenDialogMock.mockResolvedValue([{ fsPath: '/tmp/file.ts' }]);
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.attachFile')?.();

    expect(services.chatWebviewProvider.attachFile).toHaveBeenCalledWith({ fsPath: '/tmp/file.ts' });
  });

  it('newConversation runs connectAgent when there is no active session', async () => {
    const services = createServices();
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.newConversation')?.();

    expect(executeCommandMock).toHaveBeenCalledWith('acp.connectAgent');
    expect(services.sessionManager.newConversation).not.toHaveBeenCalled();
  });

  it('newConversation creates a new conversation and focuses chat when active session exists', async () => {
    const services = createServices();
    (services.sessionManager.getActiveSession as ReturnType<typeof vi.fn>).mockReturnValue({ agentDisplayName: 'Codex' });
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.newConversation')?.();

    expect(services.sessionManager.newConversation).toHaveBeenCalled();
    expect(executeCommandMock).toHaveBeenCalledWith('acp-chat.focus');
  });

  it('disconnectActiveSession shows no-active-session info when none is active', async () => {
    const services = createServices();
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.disconnectActiveSession')?.();

    expect(showInformationMessageMock).toHaveBeenCalledWith(noActiveSessionMessage);
  });

  it('disconnectActiveSession disconnects active session and shows status', async () => {
    const services = createServices();
    (services.sessionManager.getActiveSessionId as ReturnType<typeof vi.fn>).mockReturnValue('session-1');
    services.sessionManager.getSession.mockReturnValue({ agentDisplayName: 'Codex' });
    registerSessionCommands(services as never);
    const commands = buildCommandMap();

    await commands.get('acp.disconnectActiveSession')?.();

    expect(services.sessionManager.disconnectSession).toHaveBeenCalledWith('session-1');
    expect(showInformationMessageMock).toHaveBeenCalledWith('Disconnected Codex session.');
  });

  it('openChat focuses chat view', async () => {
    registerSessionCommands(createServices() as never);
    const commands = buildCommandMap();

    await commands.get('acp.openChat')?.();

    expect(executeCommandMock).toHaveBeenCalledWith('acp-chat.focus');
  });

  it('showLog and showTraffic forward telemetry and open channels', async () => {
    registerSessionCommands(createServices() as never);
    const commands = buildCommandMap();

    await commands.get('acp.showLog')?.();
    await commands.get('acp.showTraffic')?.();

    expect(sendEventMock).toHaveBeenCalledWith('command/showLog');
    expect(sendEventMock).toHaveBeenCalledWith('command/showTraffic');
    expect(outputShowMock).toHaveBeenCalled();
    expect(trafficShowMock).toHaveBeenCalled();
  });
});
