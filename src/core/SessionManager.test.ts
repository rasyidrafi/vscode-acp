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
    busy: false,
    ...overrides,
  };
}

function seedSession(manager: SessionManager, session: SessionInfo): void {
  const internals = manager as unknown as {
    sessions: Map<string, SessionInfo>;
    agentSessions: Map<string, Set<string>>;
    agentIdSessions: Map<string, string>;
    activeSessionId: string | null;
  };

  internals.sessions.set(session.sessionId, session);
  const sessionIds = internals.agentSessions.get(session.agentName) ?? new Set<string>();
  sessionIds.add(session.sessionId);
  internals.agentSessions.set(session.agentName, sessionIds);
  internals.agentIdSessions.set(session.agentId, session.sessionId);
  internals.activeSessionId = session.sessionId;
}

describe('SessionManager', () => {
  it('newConversation creates another session for the active agent', async () => {
    const agentManager = new FakeAgentManager();
    const connectionManager = new FakeConnectionManager();
    const manager = new SessionManager(
      agentManager as unknown as never,
      connectionManager as unknown as never,
      new SessionUpdateHandler(),
    );

    seedSession(manager, createSession({
      sessionId: 'session-1',
      agentId: 'agent-1',
      agentName: 'Codex',
    }));

    const child = { process: {} };
    agentManager.spawnAgent.mockReturnValueOnce({ id: 'agent-2' });
    agentManager.getAgent.mockReturnValueOnce(child);
    connectionManager.connect.mockResolvedValueOnce({
      connection: { newSession: vi.fn().mockResolvedValue({ sessionId: 'session-2' }) },
      initResponse: { agentInfo: { name: 'Codex' } },
    });

    const created = await manager.newConversation();

    expect(created?.sessionId).toBe('session-2');
    expect(manager.getActiveSessionId()).toBe('session-2');
    expect(manager.getSessionsForAgent('Codex').map(item => item.sessionId)).toEqual(['session-1', 'session-2']);
  });

  it('creates a new live session for the same agent', async () => {
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
    const child = { process: {} };
    agentManager.spawnAgent.mockReturnValueOnce({ id: 'agent-2' });
    agentManager.getAgent.mockReturnValueOnce(child);
    connectionManager.connect.mockResolvedValueOnce({
      connection: { newSession: vi.fn().mockResolvedValue({ sessionId: 'session-2' }) },
      initResponse: { agentInfo: { name: 'Codex' } },
    });

    const result = await manager.connectToAgent('Codex');

    expect(result.sessionId).toBe('session-2');
    expect(agentManager.spawnAgent).toHaveBeenCalled();
    expect(changed).toHaveBeenCalledWith('session-2');
    expect(manager.getSessionsForAgent('Codex').map(item => item.sessionId)).toEqual(['session-1', 'session-2']);
  });

  it('opens an existing session without spawning a process', () => {
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

    const result = manager.openSession('session-1');

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

    await manager.disconnectSession('session-1');
    agentManager.emit('agent-closed', { agentId: 'agent-1', code: 0 });

    expect(agentManager.killAgent).toHaveBeenCalledWith('agent-1');
    expect(connectionManager.disposeConnection).toHaveBeenCalled();
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(disconnected).toHaveBeenCalledWith('Codex', 'session-1');
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
    expect(disconnected).toHaveBeenCalledWith('Claude Code', 'session-2');
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

    const session = await manager.createSessionInstance('Codex');

    expect(authenticate).toHaveBeenCalledWith({ methodId: 'login' });
    expect(newSession).toHaveBeenCalledTimes(2);
    expect(session).toMatchObject({
      sessionId: 'session-auth',
      agentId: 'agent-auth',
      agentName: 'Codex',
    });
  });

  it('loads an existing ACP session when selected from agent session list', async () => {
    const agentManager = new FakeAgentManager();
    const connectionManager = new FakeConnectionManager();
    const manager = new SessionManager(
      agentManager as unknown as never,
      connectionManager as unknown as never,
      new SessionUpdateHandler(),
    );

    const child = { process: {} };
    const listSessions = vi.fn().mockResolvedValue({
      sessions: [
        { sessionId: 'sess-existing', cwd: process.cwd(), title: 'Existing Session', updatedAt: '2026-04-25T00:00:00.000Z' },
      ],
      nextCursor: null,
    });
    const loadSession = vi.fn().mockResolvedValue({
      modes: null,
      models: null,
      configOptions: [],
    });
    const newSession = vi.fn();

    agentManager.spawnAgent.mockReturnValue({ id: 'agent-list' });
    agentManager.getAgent.mockReturnValue(child);
    connectionManager.connect.mockResolvedValue({
      connection: {
        listSessions,
        loadSession,
        newSession,
      },
      initResponse: {
        agentInfo: { name: 'Codex' },
        agentCapabilities: { sessionCapabilities: { list: {} } },
      },
    });
    showQuickPickMock.mockResolvedValueOnce({ label: 'Existing Session', sessionId: 'sess-existing' });

    const session = await manager.createSessionInstance('Codex');

    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(loadSession).toHaveBeenCalledWith({
      sessionId: 'sess-existing',
      cwd: process.cwd(),
      mcpServers: [],
    });
    expect(newSession).not.toHaveBeenCalled();
    expect(session.sessionId).toBe('sess-existing');
  });

  it('creates a new ACP session when discovery is available but user chooses new', async () => {
    const agentManager = new FakeAgentManager();
    const connectionManager = new FakeConnectionManager();
    const manager = new SessionManager(
      agentManager as unknown as never,
      connectionManager as unknown as never,
      new SessionUpdateHandler(),
    );

    const child = { process: {} };
    const listSessions = vi.fn().mockResolvedValue({
      sessions: [
        { sessionId: 'sess-existing', cwd: process.cwd(), title: 'Existing Session', updatedAt: '2026-04-25T00:00:00.000Z' },
      ],
      nextCursor: null,
    });
    const loadSession = vi.fn();
    const newSession = vi.fn().mockResolvedValue({
      sessionId: 'sess-new',
      modes: null,
      models: null,
    });

    agentManager.spawnAgent.mockReturnValue({ id: 'agent-new' });
    agentManager.getAgent.mockReturnValue(child);
    connectionManager.connect.mockResolvedValue({
      connection: {
        listSessions,
        loadSession,
        newSession,
      },
      initResponse: {
        agentInfo: { name: 'Codex' },
        agentCapabilities: { sessionCapabilities: { list: {} } },
      },
    });
    showQuickPickMock.mockResolvedValueOnce({ label: '$(add) Start new session' });

    const session = await manager.createSessionInstance('Codex');

    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(loadSession).not.toHaveBeenCalled();
    expect(newSession).toHaveBeenCalledTimes(1);
    expect(session.sessionId).toBe('sess-new');
  });

  it('deduplicates in-flight createSessionFromTask calls for the same task', async () => {
    const agentManager = new FakeAgentManager();
    const connectionManager = new FakeConnectionManager();
    const manager = new SessionManager(
      agentManager as unknown as never,
      connectionManager as unknown as never,
      new SessionUpdateHandler(),
    );

    const child = { process: {} };
    const loadSession = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        modes: null,
        models: null,
        configOptions: [],
      };
    });

    agentManager.spawnAgent.mockReturnValue({ id: 'agent-task' });
    agentManager.getAgent.mockReturnValue(child);
    connectionManager.connect.mockResolvedValue({
      connection: {
        loadSession,
        newSession: vi.fn(),
      },
      initResponse: {
        agentInfo: { name: 'Codex' },
      },
    });

    const [sessionA, sessionB] = await Promise.all([
      manager.createSessionFromTask('Codex', 'task-1'),
      manager.createSessionFromTask('Codex', 'task-1'),
    ]);

    expect(sessionA.sessionId).toBe('task-1');
    expect(sessionB.sessionId).toBe('task-1');
    expect(agentManager.spawnAgent).toHaveBeenCalledTimes(1);
    expect(connectionManager.connect).toHaveBeenCalledTimes(1);
    expect(loadSession).toHaveBeenCalledTimes(1);
  });

  it('reuses the newest non-busy session for task switch when task history is supported', async () => {
    const agentManager = new FakeAgentManager();
    const connectionManager = new FakeConnectionManager();
    const manager = new SessionManager(
      agentManager as unknown as never,
      connectionManager as unknown as never,
      new SessionUpdateHandler(),
    );

    const oldSession = createSession({
      sessionId: 'session-old',
      agentId: 'agent-1',
      agentName: 'Codex',
      initResponse: {
        agentCapabilities: { sessionCapabilities: { list: {} } },
      } as SessionInfo['initResponse'],
    });
    seedSession(manager, oldSession);

    const loadSession = vi.fn().mockResolvedValue({
      modes: null,
      models: null,
      configOptions: [],
    });
    connectionManager.getConnection.mockReturnValue({
      connection: { loadSession },
      initResponse: oldSession.initResponse,
    });

    const switched = await manager.createSessionFromTask('Codex', 'task-target');

    expect(connectionManager.getConnection).toHaveBeenCalledWith('agent-1');
    expect(loadSession).toHaveBeenCalledWith({
      sessionId: 'task-target',
      cwd: '/workspace',
      mcpServers: [],
    });
    expect(agentManager.spawnAgent).not.toHaveBeenCalled();
    expect(switched.sessionId).toBe('task-target');
    expect(switched.sourceTaskSessionId).toBe('task-target');
    expect(manager.getSession('session-old')).toBeUndefined();
    expect(manager.getSession('task-target')).toBe(switched);
  });

  it('does not reuse existing session for task switch when agent lacks task history support', async () => {
    const agentManager = new FakeAgentManager();
    const connectionManager = new FakeConnectionManager();
    const manager = new SessionManager(
      agentManager as unknown as never,
      connectionManager as unknown as never,
      new SessionUpdateHandler(),
    );

    const oldSession = createSession({
      sessionId: 'session-old',
      agentId: 'agent-1',
      agentName: 'Codex',
      initResponse: {} as SessionInfo['initResponse'],
    });
    seedSession(manager, oldSession);

    const child = { process: {} };
    agentManager.spawnAgent.mockReturnValue({ id: 'agent-task-new' });
    agentManager.getAgent.mockReturnValue(child);
    connectionManager.connect.mockResolvedValue({
      connection: {
        loadSession: vi.fn().mockResolvedValue({ modes: null, models: null, configOptions: [] }),
        newSession: vi.fn(),
      },
      initResponse: {
        agentInfo: { name: 'Codex' },
      },
    });
    connectionManager.getConnection.mockReturnValue({
      connection: { loadSession: vi.fn() },
      initResponse: oldSession.initResponse,
    });

    const created = await manager.createSessionFromTask('Codex', 'task-new');

    expect(agentManager.spawnAgent).toHaveBeenCalledTimes(1);
    expect(created.sessionId).toBe('task-new');
    expect(created.agentId).toBe('agent-task-new');
  });

  it('recovers when loadSession reports target task is already loaded (copilot cli behavior)', async () => {
    const agentManager = new FakeAgentManager();
    const connectionManager = new FakeConnectionManager();
    const manager = new SessionManager(
      agentManager as unknown as never,
      connectionManager as unknown as never,
      new SessionUpdateHandler(),
    );

    const oldSession = createSession({
      sessionId: 'task-1',
      sourceTaskSessionId: 'task-1',
      agentId: 'agent-1',
      agentName: 'Codex',
      initResponse: {
        agentCapabilities: { sessionCapabilities: { list: {} } },
      } as SessionInfo['initResponse'],
    });
    seedSession(manager, oldSession);

    const closeSession = vi.fn().mockResolvedValue(undefined);
    const loadSession = vi.fn()
      .mockResolvedValueOnce({
        modes: null,
        models: null,
        configOptions: [],
      })
      .mockRejectedValueOnce(new Error('Session task-1 is already loaded'));
    connectionManager.getConnection.mockReturnValue({
      connection: { closeSession, loadSession },
      initResponse: oldSession.initResponse,
    });

    const switchedToTask2 = await manager.createSessionFromTask('Codex', 'task-2');
    const switchedTask2Id = switchedToTask2.sessionId;
    const reopenedTask1 = await manager.createSessionFromTask('Codex', 'task-1');
    const reopenedTask1Id = reopenedTask1.sessionId;

    expect(switchedTask2Id).toBe('task-2');
    expect(reopenedTask1Id).toBe('task-1');
    expect(reopenedTask1.sourceTaskSessionId).toBe('task-1');
    expect(closeSession).toHaveBeenCalledTimes(2);
    expect(loadSession).toHaveBeenCalledTimes(2);
    expect(manager.getSession('task-1')).toBe(reopenedTask1);
    expect(manager.getSession('task-2')).toBeUndefined();
  });

  it('tracks pending source/target task switch state while reusing an idle instance', async () => {
    const agentManager = new FakeAgentManager();
    const connectionManager = new FakeConnectionManager();
    const manager = new SessionManager(
      agentManager as unknown as never,
      connectionManager as unknown as never,
      new SessionUpdateHandler(),
    );

    const oldSession = createSession({
      sessionId: 'task-1',
      sourceTaskSessionId: 'task-1',
      agentId: 'agent-1',
      agentName: 'Codex',
      initResponse: {
        agentCapabilities: { sessionCapabilities: { list: {} } },
      } as SessionInfo['initResponse'],
    });
    seedSession(manager, oldSession);

    let resolveLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });

    const closeSession = vi.fn().mockResolvedValue(undefined);
    const loadSession = vi.fn().mockImplementation(async () => {
      await loadGate;
      return {
        modes: null,
        models: null,
        configOptions: [],
      };
    });
    connectionManager.getConnection.mockReturnValue({
      connection: { closeSession, loadSession },
      initResponse: oldSession.initResponse,
    });

    const switching = manager.createSessionFromTask('Codex', 'task-2');
    await Promise.resolve();

    expect(manager.isTaskSwitchSourcePending('Codex', 'task-1')).toBe(true);
    expect(manager.isTaskSwitchTargetPending('Codex', 'task-2')).toBe(true);

    resolveLoad();
    await switching;

    expect(manager.isTaskSwitchSourcePending('Codex', 'task-1')).toBe(false);
    expect(manager.isTaskSwitchTargetPending('Codex', 'task-2')).toBe(false);
  });
});
