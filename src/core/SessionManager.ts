import * as vscode from 'vscode';
import { EventEmitter } from 'node:events';

import type {
  NewSessionResponse,
  LoadSessionResponse,
  PromptResponse,
  InitializeResponse,
  ContentBlock,
  SessionModeState,
  SessionModelState,
  AvailableCommand,
  ListSessionsResponse,
  SessionInfo as AcpListedSessionInfo,
} from '@agentclientprotocol/sdk';
import { RequestError } from '@agentclientprotocol/sdk';

import { AgentManager } from './AgentManager';
import { ConnectionManager, ConnectionInfo } from './ConnectionManager';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { getAgentConfigs } from '../config/AgentConfig';
import { log, logError } from '../utils/Logger';
import { sendEvent, sendError } from '../utils/TelemetryManager';
import { getSessionModels } from '../shared/acpAdapters';

export interface SessionInfo {
  sessionId: string;
  /** ACP task/session id used to load this session, if applicable. */
  sourceTaskSessionId?: string;
  agentId: string;
  agentName: string;
  agentDisplayName: string;
  cwd: string;
  createdAt: string;
  initResponse: InitializeResponse;
  modes: SessionModeState | null;
  models: SessionModelState | null;
  availableCommands: AvailableCommand[];
  busy: boolean;
}

export interface CreateSessionOptions {
  /**
   * Load an existing ACP session instead of creating a fresh one.
   */
  loadSessionId?: string;
  /**
   * Skip ACP session discovery and force session/new.
   */
  skipAcpSessionDiscovery?: boolean;
}

export interface AgentTaskPage {
  tasks: AcpListedSessionInfo[];
  nextCursor: string | null;
}

/**
 * Manages the lifecycle of ACP agent connections.
 *
 * Manages visible ACP session instances.
 *
 * A session instance is intentionally modeled as one spawned agent process,
 * one ACP connection, and one ACP session. That keeps each visible instance
 * independently openable and disconnectable.
 */
export class SessionManager extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map();
  private activeSessionId: string | null = null;
  private inFlightTaskSessionCreates: Map<string, Promise<SessionInfo>> = new Map();
  private pendingTaskSwitchByAgent: Map<string, {
    targetCounts: Map<string, number>;
    sourceCounts: Map<string, number>;
  }> = new Map();

  /** Maps agentName → live session ids for that configured agent. */
  private agentSessions: Map<string, Set<string>> = new Map();
  /** Maps agentId → activeSessionId so process lifecycle can clean up deterministically. */
  private agentIdSessions: Map<string, string> = new Map();

  constructor(
    private readonly agentManager: AgentManager,
    private readonly connectionManager: ConnectionManager,
    private readonly sessionUpdateHandler: SessionUpdateHandler,
  ) {
    super();
    this.agentManager.on('agent-error', this.handleAgentError);
    this.agentManager.on('agent-closed', this.handleAgentClosed);
  }

  private readonly handleAgentError = (evt: { agentId: string; error: Error }): void => {
    const session = this.getSessionForAgentId(evt.agentId);
    if (session) {
      logError(`Agent ${session.agentName} error`, evt.error);
    } else {
      logError(`Agent ${evt.agentId} error`, evt.error);
    }
    this.emit('agent-error', evt.agentId, evt.error);
  };

  private readonly handleAgentClosed = (evt: { agentId: string; code: number | null }): void => {
    const session = this.getSessionForAgentId(evt.agentId);
    if (session) {
      log(`Agent ${session.agentName} closed with code ${evt.code}`);
      this.cleanupSessionByAgentId(evt.agentId);
    } else {
      this.connectionManager.disposeConnection(evt.agentId);
    }
    this.emit('agent-closed', evt.agentId, evt.code);
  };

  private getWorkspaceCwd(): string {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return cwd || process.cwd();
  }

  /**
   * Backward-compatible alias for creating a new session instance.
   */
  async connectToAgent(agentName: string): Promise<SessionInfo> {
    return this.createSessionInstance(agentName, { skipAcpSessionDiscovery: true });
  }

  /**
   * Create a new connected session instance for an agent and open it in chat.
   */
  async createSessionInstance(agentName: string, options: CreateSessionOptions = {}): Promise<SessionInfo> {
    const configs = getAgentConfigs();
    const config = configs[agentName];
    if (!config) {
      throw new Error(`Unknown agent: ${agentName}. Available: ${Object.keys(configs).join(', ')}`);
    }

    log(`SessionManager: connecting to agent "${agentName}"`);
    sendEvent('agent/connect.start', { agentName });
    const connectStartTime = Date.now();

    try {
      const workspaceCwd = this.getWorkspaceCwd();

      // Spawn the agent process in workspace cwd
      const agentInstance = this.agentManager.spawnAgent(agentName, config, workspaceCwd);
      const agentId = agentInstance.id;

      // Connect and initialize
      const agentProcess = this.agentManager.getAgent(agentId);
      if (!agentProcess) {
        throw new Error('Agent process not found after spawn');
      }

      let connInfo: ConnectionInfo;
      try {
        connInfo = await this.connectionManager.connect(agentId, agentProcess.process);
      } catch (e) {
        this.agentManager.killAgent(agentId);
        throw e;
      }

      const sessionToLoad = options.loadSessionId
        ?? await this.pickExistingSessionToLoad(
          agentName,
          agentId,
          connInfo,
          workspaceCwd,
          options.skipAcpSessionDiscovery === true,
        );

      // Create ACP session (with auth handling)
      const sessionInfo = await this.createAcpSession(agentName, agentId, connInfo, workspaceCwd, sessionToLoad);

      this.sessions.set(sessionInfo.sessionId, sessionInfo);
      this.addAgentSession(agentName, sessionInfo.sessionId);
      this.agentIdSessions.set(agentId, sessionInfo.sessionId);
      this.activeSessionId = sessionInfo.sessionId;

      this.emit('agent-connected', agentName, sessionInfo.sessionId);
      this.emit('active-session-changed', sessionInfo.sessionId);

      log(`Connected to agent ${agentName}, session ${sessionInfo.sessionId}`);
      sendEvent('agent/connect.end', { agentName, result: 'success' }, { duration: Date.now() - connectStartTime });
      return sessionInfo;
    } catch (e: any) {
      sendError('agent/connect.end', { agentName, result: 'error', errorMessage: e.message || String(e) }, { duration: Date.now() - connectStartTime });
      throw e;
    }
  }

  /**
   * Start a new conversation by creating another session instance for
   * the currently active session's agent.
   */
  async newConversation(): Promise<SessionInfo | null> {
    const activeSession = this.getActiveSession();
    if (!activeSession) {
      return null;
    }

    return this.createSessionInstance(activeSession.agentName, { skipAcpSessionDiscovery: true });
  }

  /**
   * Load an ACP-listed task/session for an agent into a live connected instance.
   */
  async createSessionFromTask(agentName: string, taskSessionId: string): Promise<SessionInfo> {
    const existing = this.getSessionForTask(agentName, taskSessionId);
    if (existing) {
      this.activeSessionId = existing.sessionId;
      this.emit('active-session-changed', existing.sessionId);
      return existing;
    }

    const key = `${agentName}::${taskSessionId}`;
    const inFlight = this.inFlightTaskSessionCreates.get(key);
    if (inFlight) {
      return inFlight;
    }

    const createPromise = (async () => {
      const reused = await this.reuseIdleSessionForTask(agentName, taskSessionId);
      if (reused) {
        return reused;
      }
      return this.createSessionInstance(agentName, {
        loadSessionId: taskSessionId,
        skipAcpSessionDiscovery: true,
      });
    })();

    this.inFlightTaskSessionCreates.set(key, createPromise);
    try {
      return await createPromise;
    } finally {
      if (this.inFlightTaskSessionCreates.get(key) === createPromise) {
        this.inFlightTaskSessionCreates.delete(key);
      }
    }
  }

  private async reuseIdleSessionForTask(agentName: string, taskSessionId: string): Promise<SessionInfo | null> {
    const reusable = [...this.getSessionsForAgent(agentName)]
      .reverse()
      .find((session) => !session.busy);
    if (!reusable) {
      return null;
    }

    const supportsTaskHistory = reusable.initResponse.agentCapabilities?.sessionCapabilities?.list != null;
    if (!supportsTaskHistory) {
      return null;
    }

    const connInfo = this.connectionManager.getConnection(reusable.agentId);
    if (!connInfo) {
      return null;
    }
    const connection = connInfo.connection as typeof connInfo.connection & {
      closeSession?: (params: { sessionId: string }) => Promise<unknown>;
    };

    const oldSessionId = reusable.sessionId;
    const oldTaskSessionId = reusable.sourceTaskSessionId ?? oldSessionId;
    this.beginTaskSwitch(agentName, oldTaskSessionId, taskSessionId);
    reusable.busy = true;
    this.emit('busy-changed', oldSessionId, true);

    try {
      // Best-effort unload of the currently bound session before switching task.
      // Some agents reject loadSession for a task ID that is still considered loaded.
      if (connection.closeSession) {
        try {
          await connection.closeSession({ sessionId: oldSessionId });
        } catch (closeError) {
          logError(`Failed to close session ${oldSessionId} before task switch`, closeError);
        }
      }

      let response: LoadSessionResponse;
      try {
        response = await this.withAuthRetry(agentName, reusable.agentId, connInfo, async () => (
          connection.loadSession({
            sessionId: taskSessionId,
            cwd: reusable.cwd,
            mcpServers: [],
          })
        ), 'loadSession');
      } catch (loadError) {
        // Copilot CLI can return "Session <id> is already loaded" during rapid task hops.
        // If we can resolve that to an existing instance (or current instance), avoid surfacing
        // a hard failure and just focus/open the already-loaded task.
        if (!this.isAlreadyLoadedSessionError(loadError, taskSessionId)) {
          throw loadError;
        }

        const existing = this.getSessionForTask(agentName, taskSessionId);
        if (existing) {
          this.activeSessionId = existing.sessionId;
          this.emit('active-session-changed', existing.sessionId);
          return existing;
        }

        response = {
          modes: reusable.modes,
          models: reusable.models,
          configOptions: null,
        };
      }

      // Remap keys from the old loaded task/new-session id to the target task id.
      if (oldSessionId !== taskSessionId) {
        this.sessions.delete(oldSessionId);
        this.sessions.set(taskSessionId, reusable);

        const sessionIds = this.agentSessions.get(agentName);
        if (sessionIds) {
          sessionIds.delete(oldSessionId);
          sessionIds.add(taskSessionId);
        }

        if (this.agentIdSessions.get(reusable.agentId) === oldSessionId) {
          this.agentIdSessions.set(reusable.agentId, taskSessionId);
        }
      }

      reusable.sessionId = taskSessionId;
      reusable.sourceTaskSessionId = taskSessionId;
      reusable.modes = response.modes ?? null;
      reusable.models = getSessionModels(response);
      this.activeSessionId = taskSessionId;
      this.emit('active-session-changed', taskSessionId);
      return reusable;
    } finally {
      this.endTaskSwitch(agentName, oldTaskSessionId, taskSessionId);
      reusable.busy = false;
      this.emit('busy-changed', reusable.sessionId, false);
    }
  }

  private beginTaskSwitch(agentName: string, fromTaskSessionId: string, toTaskSessionId: string): void {
    const entry = this.pendingTaskSwitchByAgent.get(agentName) ?? {
      targetCounts: new Map<string, number>(),
      sourceCounts: new Map<string, number>(),
    };
    entry.targetCounts.set(toTaskSessionId, (entry.targetCounts.get(toTaskSessionId) ?? 0) + 1);
    entry.sourceCounts.set(fromTaskSessionId, (entry.sourceCounts.get(fromTaskSessionId) ?? 0) + 1);
    this.pendingTaskSwitchByAgent.set(agentName, entry);
    this.emit('task-switch-state-changed', agentName);
  }

  private endTaskSwitch(agentName: string, fromTaskSessionId: string, toTaskSessionId: string): void {
    const entry = this.pendingTaskSwitchByAgent.get(agentName);
    if (!entry) {
      return;
    }

    const targetCount = (entry.targetCounts.get(toTaskSessionId) ?? 0) - 1;
    if (targetCount > 0) {
      entry.targetCounts.set(toTaskSessionId, targetCount);
    } else {
      entry.targetCounts.delete(toTaskSessionId);
    }

    const sourceCount = (entry.sourceCounts.get(fromTaskSessionId) ?? 0) - 1;
    if (sourceCount > 0) {
      entry.sourceCounts.set(fromTaskSessionId, sourceCount);
    } else {
      entry.sourceCounts.delete(fromTaskSessionId);
    }

    if (entry.targetCounts.size === 0 && entry.sourceCounts.size === 0) {
      this.pendingTaskSwitchByAgent.delete(agentName);
    } else {
      this.pendingTaskSwitchByAgent.set(agentName, entry);
    }
    this.emit('task-switch-state-changed', agentName);
  }

  /**
   * Disconnect all live session instances for an agent.
   */
  async disconnectAgent(agentName: string): Promise<void> {
    const sessionIds = this.agentSessions.get(agentName);
    if (!sessionIds) { return; }

    for (const sessionId of Array.from(sessionIds)) {
      await this.disconnectSession(sessionId);
    }
  }

  /**
   * Disconnect a specific session instance.
   */
  async disconnectSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }

    log(`Disconnecting session ${sessionId} for agent ${session.agentName}`);
    sendEvent('agent/disconnect', { agentName: session.agentName });

    this.cleanupSessionByAgentId(session.agentId);
    this.agentManager.killAgent(session.agentId);
  }

  /**
   * Open an existing connected session instance in chat.
   */
  openSession(sessionId: string): SessionInfo | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    this.activeSessionId = sessionId;
    this.emit('active-session-changed', sessionId);
    return session;
  }

  /**
   * Internal: create the ACP session with auth handling.
   */
  private async createAcpSession(
    agentName: string,
    agentId: string,
    connInfo: ConnectionInfo,
    cwd: string,
    sessionToLoad?: string,
  ): Promise<SessionInfo> {
    let sessionId: string;
    let sessionResponse: NewSessionResponse | LoadSessionResponse;
    try {
      if (sessionToLoad) {
        sessionResponse = await this.withAuthRetry(agentName, agentId, connInfo, async () => (
          connInfo.connection.loadSession({
            sessionId: sessionToLoad,
            cwd,
            mcpServers: [],
          })
        ), 'loadSession');
        sessionId = sessionToLoad;
      } else {
        const newSessionResponse = await this.withAuthRetry(agentName, agentId, connInfo, async () => (
          connInfo.connection.newSession({
            cwd,
            mcpServers: [],
          })
        ), 'newSession');
        sessionResponse = newSessionResponse;
        sessionId = newSessionResponse.sessionId;
      }
    } catch (e: any) {
      logError(`Failed to ${sessionToLoad ? 'load' : 'create'} session`, e);
      this.agentManager.killAgent(agentId);
      throw e;
    }

    return {
      sessionId,
      ...(sessionToLoad ? { sourceTaskSessionId: sessionToLoad } : {}),
      agentId,
      agentName,
      agentDisplayName: connInfo.initResponse.agentInfo?.title ||
        connInfo.initResponse.agentInfo?.name ||
        getAgentConfigs()[agentName]?.displayName ||
        agentName,
      cwd,
      createdAt: new Date().toISOString(),
      initResponse: connInfo.initResponse,
      modes: sessionResponse.modes ?? null,
      models: getSessionModels(sessionResponse),
      availableCommands: [],
      busy: false,
    };
  }

  private async pickExistingSessionToLoad(
    agentName: string,
    agentId: string,
    connInfo: ConnectionInfo,
    cwd: string,
    skipDiscovery: boolean,
  ): Promise<string | undefined> {
    if (skipDiscovery) {
      return undefined;
    }

    if (!connInfo.initResponse.agentCapabilities?.sessionCapabilities?.list) {
      return undefined;
    }

    const sessions = await this.listAgentSessions(agentName, agentId, connInfo, cwd);
    if (sessions.length === 0) {
      return undefined;
    }

    const items: Array<vscode.QuickPickItem & { sessionId?: string }> = [
      {
        label: '$(add) Start new session',
        description: 'Create a fresh session context',
      },
      ...sessions.map((session) => ({
        label: session.title?.trim() || `Session ${session.sessionId.slice(0, 8)}`,
        description: session.updatedAt
          ? `${session.sessionId} • updated ${new Date(session.updatedAt).toLocaleString()}`
          : session.sessionId,
        detail: session.cwd,
        sessionId: session.sessionId,
      })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: `${connInfo.initResponse.agentInfo?.title ?? agentName} Sessions`,
      placeHolder: 'Load an existing ACP session or start a new one',
    });

    return picked?.sessionId;
  }

  private async listAgentSessions(
    agentName: string,
    agentId: string,
    connInfo: ConnectionInfo,
    cwd: string,
  ): Promise<ListSessionsResponse['sessions']> {
    const allSessions: ListSessionsResponse['sessions'] = [];
    let cursor: string | null | undefined = undefined;
    do {
      const response = await this.withAuthRetry(agentName, agentId, connInfo, async () => (
        connInfo.connection.listSessions({
          cwd,
          cursor: cursor ?? undefined,
        })
      ), 'listSessions');
      allSessions.push(...response.sessions);
      cursor = response.nextCursor;
    } while (cursor);

    allSessions.sort((left, right) => {
      const leftTs = left.updatedAt ? Date.parse(left.updatedAt) : 0;
      const rightTs = right.updatedAt ? Date.parse(right.updatedAt) : 0;
      return rightTs - leftTs;
    });
    return allSessions;
  }

  /**
   * Fetch ACP task list (session/list) via a temporary connection.
   * This does not create a visible live session instance.
   */
  async listAgentTasks(agentName: string): Promise<AcpListedSessionInfo[] | null> {
    const configs = getAgentConfigs();
    const config = configs[agentName];
    if (!config) {
      throw new Error(`Unknown agent: ${agentName}`);
    }

    const workspaceCwd = this.getWorkspaceCwd();
    const temp = this.agentManager.spawnAgent(agentName, config, workspaceCwd);
    const tempAgentId = temp.id;

    try {
      const processInfo = this.agentManager.getAgent(tempAgentId);
      if (!processInfo) {
        throw new Error('Agent process not found after spawn');
      }
      const connInfo = await this.connectionManager.connect(tempAgentId, processInfo.process);
      if (!connInfo.initResponse.agentCapabilities?.sessionCapabilities?.list) {
        return null;
      }
      return await this.listAgentSessions(agentName, tempAgentId, connInfo, workspaceCwd);
    } finally {
      this.connectionManager.disposeConnection(tempAgentId);
      this.agentManager.killAgent(tempAgentId);
    }
  }

  /**
   * Fetch one page of ACP task history (session/list) via a temporary connection.
   * Returns null when the agent does not support task history.
   */
  async listAgentTasksPage(agentName: string, cursor?: string): Promise<AgentTaskPage | null> {
    const configs = getAgentConfigs();
    const config = configs[agentName];
    if (!config) {
      throw new Error(`Unknown agent: ${agentName}`);
    }

    const workspaceCwd = this.getWorkspaceCwd();
    const temp = this.agentManager.spawnAgent(agentName, config, workspaceCwd);
    const tempAgentId = temp.id;

    try {
      const processInfo = this.agentManager.getAgent(tempAgentId);
      if (!processInfo) {
        throw new Error('Agent process not found after spawn');
      }

      const connInfo = await this.connectionManager.connect(tempAgentId, processInfo.process);
      if (!connInfo.initResponse.agentCapabilities?.sessionCapabilities?.list) {
        return null;
      }

      const response = await this.withAuthRetry(agentName, tempAgentId, connInfo, async () => (
        connInfo.connection.listSessions({
          cwd: workspaceCwd,
          cursor,
        })
      ), 'listSessions');

      return {
        tasks: response.sessions,
        nextCursor: response.nextCursor ?? null,
      };
    } finally {
      this.connectionManager.disposeConnection(tempAgentId);
      this.agentManager.killAgent(tempAgentId);
    }
  }

  private isAuthRequiredError(e: unknown): boolean {
    const err = e as { code?: unknown; message?: unknown } | undefined;
    return (e instanceof RequestError && e.code === -32000)
      || err?.code === -32000
      || (typeof err?.message === 'string' && /auth.?required/i.test(err.message));
  }

  private isAlreadyLoadedSessionError(error: unknown, sessionId: string): boolean {
    const message = String((error as { message?: unknown } | undefined)?.message ?? '');
    if (!message) {
      return false;
    }
    const escapedId = sessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`session\\s+${escapedId}\\s+is\\s+already\\s+loaded`, 'i');
    return pattern.test(message);
  }

  private async authenticateAgentSession(
    agentName: string,
    connInfo: ConnectionInfo,
  ): Promise<void> {
    const authMethods = connInfo.initResponse.authMethods;
    if (!authMethods || authMethods.length === 0) {
      throw new Error(`Agent "${agentName}" requires authentication but did not advertise any auth methods.`);
    }

    log(`Agent requires authentication. Methods: ${authMethods.map(m => m.name).join(', ')}`);

    let selectedMethod = authMethods[0];
    if (authMethods.length > 1) {
      const picked = await vscode.window.showQuickPick(
        authMethods.map(m => ({
          label: m.name,
          description: m.description || '',
          detail: `ID: ${m.id}`,
          method: m,
        })),
        {
          placeHolder: 'Select an authentication method',
          title: `${agentName} requires authentication`,
        },
      );
      if (!picked) {
        throw new Error('Authentication cancelled by user.');
      }
      selectedMethod = picked.method;
    } else {
      const confirm = await vscode.window.showInformationMessage(
        `${agentName} requires authentication via "${selectedMethod.name}".`,
        { modal: true, detail: selectedMethod.description || undefined },
        'Authenticate',
      );
      if (confirm !== 'Authenticate') {
        throw new Error('Authentication cancelled by user.');
      }
    }

    try {
      log(`Authenticating with method: ${selectedMethod.name} (${selectedMethod.id})`);
      await connInfo.connection.authenticate({ methodId: selectedMethod.id });
      log('Authentication successful');
    } catch (authErr: any) {
      logError('Authentication failed', authErr);
      throw new Error(`Authentication failed: ${authErr?.message || String(authErr)}`);
    }
  }

  private async withAuthRetry<T>(
    agentName: string,
    agentId: string,
    connInfo: ConnectionInfo,
    action: () => Promise<T>,
    actionName: string,
  ): Promise<T> {
    try {
      return await action();
    } catch (e) {
      if (!this.isAuthRequiredError(e)) {
        throw e;
      }

      try {
        await this.authenticateAgentSession(agentName, connInfo);
      } catch (authError) {
        this.agentManager.killAgent(agentId);
        throw authError;
      }

      try {
        return await action();
      } catch (retryError) {
        logError(`Failed to ${actionName} after authentication`, retryError);
        throw retryError;
      }
    }
  }

  /**
   * Send a prompt to the active session.
   */
  async sendPrompt(sessionId: string, text: string): Promise<PromptResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const connInfo = this.connectionManager.getConnection(session.agentId);
    if (!connInfo) {
      throw new Error(`No connection for agent: ${session.agentId}`);
    }

    log(`sendPrompt: session=${sessionId}, text="${text.substring(0, 50)}..."`);

    const prompt: ContentBlock[] = [
      { type: 'text', text },
    ];

    session.busy = true;
    this.emit('busy-changed', sessionId, true);

    try {
      const response = await connInfo.connection.prompt({
        sessionId,
        prompt,
      });

      log(`Prompt response: stopReason=${response.stopReason}`);
      return response;
    } finally {
      session.busy = false;
      this.emit('busy-changed', sessionId, false);
    }
  }

  /**
   * Cancel an active prompt turn.
   */
  async cancelTurn(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }

    const connInfo = this.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return; }

    log(`Cancelling turn for session ${sessionId}`);
    await connInfo.connection.cancel({ sessionId });
  }

  /**
   * Set the session mode (e.g., plan mode, code mode).
   */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }

    const connInfo = this.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return; }

    await connInfo.connection.setSessionMode({ sessionId, modeId });

    // Update local state
    if (session.modes) {
      session.modes.currentModeId = modeId;
    }
    this.emit('mode-changed', sessionId, modeId);
  }

  /**
   * Set the session model (experimental).
   */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }

    const connInfo = this.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return; }

    const connection = connInfo.connection as typeof connInfo.connection & {
      unstable_setSessionModel?: (params: { sessionId: string; modelId: string }) => Promise<unknown>;
    };
    if (!connection.unstable_setSessionModel) {
      throw new Error('Active agent does not support session model switching.');
    }

    await connection.unstable_setSessionModel({ sessionId, modelId });

    // Update local state
    if (session.models) {
      session.models.currentModelId = modelId;
    }
    this.emit('model-changed', sessionId, modelId);
  }

  // --- Getters ---

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionForTask(agentName: string, taskSessionId: string): SessionInfo | undefined {
    const sessions = this.getSessionsForAgent(agentName);
    return sessions.find((session) =>
      session.sessionId === taskSessionId || session.sourceTaskSessionId === taskSessionId,
    );
  }

  isTaskSwitchTargetPending(agentName: string, taskSessionId: string): boolean {
    return (this.pendingTaskSwitchByAgent.get(agentName)?.targetCounts.get(taskSessionId) ?? 0) > 0;
  }

  isTaskSwitchSourcePending(agentName: string, taskSessionId: string): boolean {
    return (this.pendingTaskSwitchByAgent.get(agentName)?.sourceCounts.get(taskSessionId) ?? 0) > 0;
  }

  getActiveSession(): SessionInfo | undefined {
    if (!this.activeSessionId) { return undefined; }
    return this.sessions.get(this.activeSessionId);
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  /** Get the agent name for the current active session. */
  getActiveAgentName(): string | null {
    const session = this.getActiveSession();
    return session?.agentName ?? null;
  }

  /** Check if a specific agent is currently connected. */
  isAgentConnected(agentName: string): boolean {
    return (this.agentSessions.get(agentName)?.size ?? 0) > 0;
  }

  /** Check if a specific agent is currently busy. */
  isAgentBusy(agentName: string): boolean {
    return this.getSessionsForAgent(agentName).some(session => session.busy);
  }

  /** Get all connected agent names. */
  getConnectedAgentNames(): string[] {
    return Array.from(this.agentSessions.keys());
  }

  /** Get all live session instances. */
  getSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /** Get live session instances for an agent. */
  getSessionsForAgent(agentName: string): SessionInfo[] {
    const sessionIds = this.agentSessions.get(agentName);
    if (!sessionIds) {
      return [];
    }

    return Array.from(sessionIds)
      .map(sessionId => this.sessions.get(sessionId))
      .filter((session): session is SessionInfo => Boolean(session))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getConnectionForSession(sessionId: string): ConnectionInfo | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) { return undefined; }
    return this.connectionManager.getConnection(session.agentId);
  }

  private getSessionForAgentId(agentId: string): SessionInfo | undefined {
    const sessionId = this.agentIdSessions.get(agentId);
    if (!sessionId) {
      return undefined;
    }
    return this.sessions.get(sessionId);
  }

  private addAgentSession(agentName: string, sessionId: string): void {
    const sessionIds = this.agentSessions.get(agentName) ?? new Set<string>();
    sessionIds.add(sessionId);
    this.agentSessions.set(agentName, sessionIds);
  }

  private cleanupSessionByAgentId(agentId: string): void {
    const sessionId = this.agentIdSessions.get(agentId);
    if (!sessionId) {
      return;
    }

    const session = this.sessions.get(sessionId);
    this.agentIdSessions.delete(agentId);
    this.sessions.delete(sessionId);

    if (session) {
      const sessionIds = this.agentSessions.get(session.agentName);
      sessionIds?.delete(sessionId);
      if (sessionIds && sessionIds.size === 0) {
        this.agentSessions.delete(session.agentName);
      }
    }

    const wasActive = this.activeSessionId === sessionId;
    if (wasActive) {
      this.activeSessionId = null;
    }

    this.connectionManager.disposeConnection(agentId);

    if (session) {
      this.emit('agent-disconnected', session.agentName, sessionId);
    }
    if (wasActive) {
      this.emit('active-session-changed', null);
    }
  }

  // --- Cleanup ---

  dispose(): void {
    this.agentManager.killAll();
    this.connectionManager.dispose();
    this.sessions.clear();
    this.agentSessions.clear();
    this.agentIdSessions.clear();
    this.pendingTaskSwitchByAgent.clear();
    this.agentManager.off('agent-error', this.handleAgentError);
    this.agentManager.off('agent-closed', this.handleAgentClosed);
  }
}
