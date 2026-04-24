import * as vscode from 'vscode';
import { EventEmitter } from 'node:events';

import type { NewSessionResponse, PromptResponse, InitializeResponse, ContentBlock, SessionModeState, SessionModelState, AvailableCommand } from '@agentclientprotocol/sdk';
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

/**
 * Manages the lifecycle of ACP agent connections.
 *
 * The "session" concept is hidden from the user — they just see agents.
 * Internally we still use ACP sessions for protocol compliance, but the
 * user-facing model is: pick an agent → chat.
 */
export class SessionManager extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map();
  private activeSessionId: string | null = null;

  /** Maps agentName → activeSessionId for the one-session-per-agent model. */
  private agentSessions: Map<string, string> = new Map();
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
   * Connect to an agent and start chatting.
   * Internally creates a session via ACP protocol.
   */
  async connectToAgent(agentName: string): Promise<SessionInfo> {
    // If we already have a live session with this agent, reuse it
    const existingSessionId = this.agentSessions.get(agentName);
    if (existingSessionId && this.sessions.has(existingSessionId)) {
      this.activeSessionId = existingSessionId;
      this.emit('active-session-changed', existingSessionId);
      return this.sessions.get(existingSessionId)!;
    }

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

      // Create ACP session (with auth handling)
      const sessionInfo = await this.createAcpSession(agentName, agentId, connInfo, workspaceCwd);

      this.sessions.set(sessionInfo.sessionId, sessionInfo);
      this.agentSessions.set(agentName, sessionInfo.sessionId);
      this.agentIdSessions.set(agentId, sessionInfo.sessionId);
      this.activeSessionId = sessionInfo.sessionId;

      this.emit('agent-connected', agentName);
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
   * Start a new conversation with the currently connected agent.
   * Disconnects current session, reconnects, and signals chat to clear.
   */
  async newConversation(): Promise<SessionInfo | null> {
    const activeSession = this.getActiveSession();
    if (!activeSession) {
      return null;
    }

    const agentName = activeSession.agentName;
    await this.disconnectAgent(agentName);
    this.emit('clear-chat');
    return this.connectToAgent(agentName);
  }

  /**
   * Disconnect from an agent: kill process and clean up.
   */
  async disconnectAgent(agentName: string): Promise<void> {
    const sessionId = this.agentSessions.get(agentName);
    if (!sessionId) { return; }

    const session = this.sessions.get(sessionId);
    if (!session) { return; }

    log(`Disconnecting agent ${agentName}`);
    sendEvent('agent/disconnect', { agentName });

    this.cleanupSessionByAgentId(session.agentId);
    this.agentManager.killAgent(session.agentId);
  }

  /**
   * Internal: create the ACP session with auth handling.
   */
  private async createAcpSession(
    agentName: string,
    agentId: string,
    connInfo: ConnectionInfo,
    cwd: string,
  ): Promise<SessionInfo> {
    let sessionResponse: NewSessionResponse;
    try {
      sessionResponse = await connInfo.connection.newSession({
        cwd,
        mcpServers: [],
      });
    } catch (e: any) {
      // Check for auth_required error (code -32000)
      const isAuthRequired = (e instanceof RequestError && e.code === -32000)
        || (e?.code === -32000)
        || (typeof e?.message === 'string' && /auth.?required/i.test(e.message));

      if (!isAuthRequired) {
        logError('Failed to create session', e);
        this.agentManager.killAgent(agentId);
        throw e;
      }

      // Auth required — gather available methods
      const authMethods = connInfo.initResponse.authMethods;
      if (!authMethods || authMethods.length === 0) {
        this.agentManager.killAgent(agentId);
        throw new Error(
          `Agent "${agentName}" requires authentication but did not advertise any auth methods.`,
        );
      }

      log(`Agent requires authentication. Methods: ${authMethods.map(m => m.name).join(', ')}`);

      // Let the user choose an auth method
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
          this.agentManager.killAgent(agentId);
          throw new Error('Authentication cancelled by user.');
        }
        selectedMethod = picked.method;
      } else {
        // Single auth method — show a confirmation
        const confirm = await vscode.window.showInformationMessage(
          `${agentName} requires authentication via "${selectedMethod.name}".`,
          { modal: true, detail: selectedMethod.description || undefined },
          'Authenticate',
        );
        if (confirm !== 'Authenticate') {
          this.agentManager.killAgent(agentId);
          throw new Error('Authentication cancelled by user.');
        }
      }

      // Perform authentication
      try {
        log(`Authenticating with method: ${selectedMethod.name} (${selectedMethod.id})`);
        await connInfo.connection.authenticate({ methodId: selectedMethod.id });
        log('Authentication successful');
      } catch (authErr: any) {
        logError('Authentication failed', authErr);
        this.agentManager.killAgent(agentId);
        throw new Error(`Authentication failed: ${authErr.message}`);
      }

      // Retry session/new after successful authentication
      try {
        sessionResponse = await connInfo.connection.newSession({
          cwd,
          mcpServers: [],
        });
      } catch (retryErr) {
        logError('Failed to create session after authentication', retryErr);
        this.agentManager.killAgent(agentId);
        throw retryErr;
      }
    }

    return {
      sessionId: sessionResponse.sessionId,
      agentId,
      agentName,
      agentDisplayName: connInfo.initResponse.agentInfo?.title ||
        connInfo.initResponse.agentInfo?.name ||
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
    return this.agentSessions.has(agentName);
  }

  /** Check if a specific agent is currently busy. */
  isAgentBusy(agentName: string): boolean {
    const sessionId = this.agentSessions.get(agentName);
    if (!sessionId) { return false; }
    return this.sessions.get(sessionId)?.busy ?? false;
  }

  /** Get all connected agent names. */
  getConnectedAgentNames(): string[] {
    return Array.from(this.agentSessions.keys());
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

  private cleanupSessionByAgentId(agentId: string): void {
    const sessionId = this.agentIdSessions.get(agentId);
    if (!sessionId) {
      return;
    }

    const session = this.sessions.get(sessionId);
    this.agentIdSessions.delete(agentId);
    this.sessions.delete(sessionId);

    if (session) {
      this.agentSessions.delete(session.agentName);
    }

    const wasActive = this.activeSessionId === sessionId;
    if (wasActive) {
      this.activeSessionId = null;
    }

    this.connectionManager.disposeConnection(agentId);

    if (session) {
      this.emit('agent-disconnected', session.agentName);
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
    this.agentManager.off('agent-error', this.handleAgentError);
    this.agentManager.off('agent-closed', this.handleAgentClosed);
  }
}
