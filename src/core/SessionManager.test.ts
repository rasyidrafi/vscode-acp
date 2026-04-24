import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { RequestError } from '@agentclientprotocol/sdk';

const { showQuickPickMock, showInformationMessageMock } = vi.hoisted(() => ({
  showQuickPickMock: vi.fn(),
  showInformationMessageMock: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: undefined,
  },
  window: {
    showQuickPick: showQuickPickMock,
    showInformationMessage: showInformationMessageMock,
  },
}));

vi.mock('../utils/Logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../utils/TelemetryManager', () => ({
  sendEvent: vi.fn(),
  sendError: vi.fn(),
}));

vi.mock('../config/AgentConfig', () => ({
  getAgentConfigs: vi.fn(() => ({
    Codex: { command: 'npx', args: ['codex'] },
    'Claude Code': { command: 'npx', args: ['claude'] },
  })),
}));

import { SessionManager, SessionInfo } from './SessionManager';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';

class FakeAgentManager extends EventEmitter {
  public killAgent = vi.fn(() => true);
  public killAll = vi.fn();
  public getAgent = vi.fn();
  public spawnAgent = vi.fn();
}

class FakeConnectionManager {
  public connect = vi.fn();
  public disposeConnection = vi.fn();
  public dispose = vi.fn();
  public getConnection = vi.fn();
}

function createSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: 'session-1',
    agentId: 'agent-1',
    agentName: 'Codex',
    agentDisplayName: 'Codex',
    cwd: '/workspace',
    createdAt: new Date().toISOString(),
    initResponse: {} as SessionInfo['initResponse'],
    modes: null,
    models: null,
    availableCommands: [],
    ...overrides,
  };
}

function seedSession(manager: SessionManager, session: SessionInfo): void {
  const internals = manager as unknown as {
    sessions: Map<string, SessionInfo>;
    agentSessions: Map<string, string>;
    agentIdSessions: Map<string, string>;
    activeSessionId: string | null;
  };

  internals.sessions.set(session.sessionId, session);
  internals.agentSessions.set(session.agentName, session.sessionId);
  internals.agentIdSessions.set(session.agentId, session.sessionId);
  internals.activeSessionId = session.sessionId;
}

describe('SessionManager', () => {
  it('reuses an existing live session for the same agent', async () => {
    const agentManager = new FakeAgentManager();
    const connectionManager = new FakeConnectionManager();
    const manager = new SessionManager(
      agentManager as unknown as never,
      connectionManager as unknown as never,
      new SessionUpdateHandler(),
    );

    const session = createSession();
    seedSession(manager, session);
    const changed = vi.fn();
    manager.on('active-session-changed', changed);

    const result = await manager.connectToAgent('Codex');

    expect(result).toBe(session);
    expect(agentManager.spawnAgent).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledWith('session-1');
  });

  it('connects to a second agent without disconnecting the first', async () => {
    const agentManager = new FakeAgentManager();
    const connectionManager = new FakeConnectionManager();
    const manager = new SessionManager(
      agentManager as unknown as never,
      connectionManager as unknown as never,
      new SessionUpdateHandler(),
    );

    // First agent session
    const child1 = { process: {} };
    agentManager.spawnAgent.mockReturnValueOnce({ id: 'agent-1' });
    agentManager.getAgent.mockReturnValueOnce(child1);
    connectionManager.connect.mockResolvedValueOnce({
      connection: { newSession: vi.fn().mockResolvedValue({ sessionId: 'session-1' }) },
      initResponse: { agentInfo: { name: 'Codex' } },
    });
    await manager.connectToAgent('Codex');

    // Second agent session
    const child2 = { process: {} };
    agentManager.spawnAgent.mockReturnValueOnce({ id: 'agent-2' });
    agentManager.getAgent.mockReturnValueOnce(child2);
    connectionManager.connect.mockResolvedValueOnce({
      connection: { newSession: vi.fn().mockResolvedValue({ sessionId: 'session-2' }) },
      initResponse: { agentInfo: { name: 'Claude Code' } },
    });
    await manager.connectToAgent('Claude Code');

    expect(manager.getConnectedAgentNames()).toContain('Codex');
    expect(manager.getConnectedAgentNames()).toContain('Claude Code');
    expect(manager.getActiveAgentName()).toBe('Claude Code');
    expect(agentManager.killAgent).not.toHaveBeenCalled();
  });

  it('disconnects an agent with idempotent cleanup', async () => {
    const agentManager = new FakeAgentManager();
    const connectionManager = new FakeConnectionManager();
    const manager = new SessionManager(
      agentManager as unknown as never,
      connectionManager as unknown as never,
      new SessionUpdateHandler(),
    );

    seedSession(manager, createSession());

    const disconnected = vi.fn();
    const activeChanged = vi.fn();
    manager.on('agent-disconnected', disconnected);
    manager.on('active-session-changed', activeChanged);

    await manager.disconnectAgent('Codex');
    agentManager.emit('agent-closed', { agentId: 'agent-1', code: 0 });

    expect(agentManager.killAgent).toHaveBeenCalledWith('agent-1');
    expect(connectionManager.disposeConnection).toHaveBeenCalled();
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(disconnected).toHaveBeenCalledWith('Codex');
    expect(activeChanged).toHaveBeenCalledTimes(1);
    expect(activeChanged).toHaveBeenCalledWith(null);
    expect(manager.getActiveSessionId()).toBeNull();
    expect(manager.isAgentConnected('Codex')).toBe(false);
  });

  it('cleans up by agent id when the process closes unexpectedly', () => {
    const agentManager = new FakeAgentManager();
    const connectionManager = new FakeConnectionManager();
    const manager = new SessionManager(
      agentManager as unknown as never,
      connectionManager as unknown as never,
      new SessionUpdateHandler(),
    );

    seedSession(manager, createSession({
      sessionId: 'session-2',
      agentId: 'agent-2',
      agentName: 'Claude Code',
    }));

    const disconnected = vi.fn();
    const activeChanged = vi.fn();
    const closed = vi.fn();
    manager.on('agent-disconnected', disconnected);
    manager.on('active-session-changed', activeChanged);
    manager.on('agent-closed', closed);

    agentManager.emit('agent-closed', { agentId: 'agent-2', code: 137 });

    expect(connectionManager.disposeConnection).toHaveBeenCalledWith('agent-2');
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(disconnected).toHaveBeenCalledWith('Claude Code');
    expect(activeChanged).toHaveBeenCalledWith(null);
    expect(closed).toHaveBeenCalledWith('agent-2', 137);
    expect(manager.getSession('session-2')).toBeUndefined();
  });

  it('authenticates and retries session creation when the agent requires auth', async () => {
    const agentManager = new FakeAgentManager();
    const connectionManager = new FakeConnectionManager();
    const manager = new SessionManager(
      agentManager as unknown as never,
      connectionManager as unknown as never,
      new SessionUpdateHandler(),
    );

    const child = { process: {} };
    const newSession = vi.fn()
      .mockRejectedValueOnce(new RequestError(-32000, 'auth required'))
      .mockResolvedValueOnce({
        sessionId: 'session-auth',
        modes: null,
        models: null,
      });
    const authenticate = vi.fn().mockResolvedValue({});

    agentManager.spawnAgent.mockReturnValue({ id: 'agent-auth' });
    agentManager.getAgent.mockReturnValue(child);
    connectionManager.connect.mockResolvedValue({
      connection: {
        newSession,
        authenticate,
      },
      initResponse: {
        authMethods: [{ id: 'login', name: 'Login' }],
      },
    });
    showInformationMessageMock.mockResolvedValue('Authenticate');

    const session = await manager.connectToAgent('Codex');

    expect(authenticate).toHaveBeenCalledWith({ methodId: 'login' });
    expect(newSession).toHaveBeenCalledTimes(2);
    expect(session).toMatchObject({
      sessionId: 'session-auth',
      agentId: 'agent-auth',
      agentName: 'Codex',
    });
  });
});
