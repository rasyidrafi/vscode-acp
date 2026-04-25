import * as vscode from 'vscode';
import type { SessionInfo as AcpListedSessionInfo } from '@agentclientprotocol/sdk';
import { SessionInfo, SessionManager } from '../core/SessionManager';
import { getAgentConfigs, isConfigurableAgent } from '../config/AgentConfig';
import { getShortSessionId } from '../shared/sessionDisplay';

/**
 * A tree item representing a configured agent.
 */
class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly agentId: string,
    public readonly agentDisplayName: string,
    public readonly connected: boolean,
    public readonly busy: boolean,
    public readonly sessionCount: number,
  ) {
    super(agentDisplayName, vscode.TreeItemCollapsibleState.Collapsed);

    if (connected) {
      this.contextValue = isConfigurableAgent(agentId) ? 'agent-connected-configurable' : 'agent-connected';
      this.iconPath = new vscode.ThemeIcon(
        'circle-filled',
        new vscode.ThemeColor('testing.iconPassed'),
      );
      this.description = busy ? `${sessionCount} busy` : `${sessionCount} connected`;
    } else {
      this.contextValue = isConfigurableAgent(agentId) ? 'agent-disconnected-configurable' : 'agent-disconnected';
      this.iconPath = new vscode.ThemeIcon('circle-outline');
      this.description = '';
    }

    this.tooltip = connected
      ? `${agentDisplayName} — ${sessionCount} connected session(s)\nRegistry id: ${agentId}\nUse the plus icon to create another instance`
      : `${agentDisplayName} — no connected sessions\nRegistry id: ${agentId}\nUse the plus icon to create an instance`;
  }
}

class SessionGroupTreeItem extends vscode.TreeItem {
  constructor(public readonly agentId: string) {
    super('Sessions', vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'agent-sessions-group';
    this.iconPath = new vscode.ThemeIcon('vm');
  }
}

class SessionTreeItem extends vscode.TreeItem {
  public readonly sessionId: string;

  constructor(
    public readonly session: SessionInfo,
    public readonly active: boolean,
  ) {
    const shortId = getShortSessionId(session.sessionId);
    super(`Session ${shortId}`, vscode.TreeItemCollapsibleState.None);

    this.sessionId = session.sessionId;
    this.id = session.sessionId;
    this.contextValue = active ? 'session-active' : 'session-connected';
    const isBusy = session.busy;
    this.iconPath = new vscode.ThemeIcon(
      isBusy ? 'sync~spin' : 'circle-filled',
      new vscode.ThemeColor(isBusy || active ? 'testing.iconPassed' : 'testing.iconPassed'),
    );
    this.description = session.busy ? 'busy' : active ? 'active' : '';
    this.command = {
      command: 'acp.openSession',
      title: 'Open Session',
      arguments: [session.sessionId],
    };
    this.tooltip = [
      `${session.agentDisplayName} session`,
      `Session id: ${session.sessionId}`,
      `Created: ${new Date(session.createdAt).toLocaleString()}`,
      `CWD: ${session.cwd}`,
    ].join('\n');
  }
}

class TaskSessionTreeItem extends vscode.TreeItem {
  public readonly sessionId?: string;

  constructor(
    public readonly agentId: string,
    public readonly task: AcpListedSessionInfo,
    public readonly connectedSession: SessionInfo | undefined,
    public readonly active: boolean,
    public readonly pendingAsTarget: boolean,
    public readonly pendingAsSource: boolean,
  ) {
    const shortId = getShortSessionId(task.sessionId);
    super(task.title?.trim() || `Session ${shortId}`, vscode.TreeItemCollapsibleState.None);

    this.id = `${agentId}:task:${task.sessionId}`;
    this.sessionId = connectedSession?.sessionId;

    const isBusy = pendingAsTarget || (connectedSession?.busy === true && !pendingAsSource);
    const isConnected = Boolean(connectedSession) && !pendingAsSource;

    this.contextValue = active
      ? 'session-active'
      : isConnected
        ? 'session-connected'
        : 'task-disconnected';
    this.iconPath = new vscode.ThemeIcon(
      isBusy ? 'sync~spin' : isConnected ? 'circle-filled' : 'circle-outline',
      isConnected || isBusy
        ? new vscode.ThemeColor('testing.iconPassed')
        : new vscode.ThemeColor('foreground'),
    );
    this.description = pendingAsSource
      ? 'disconnecting'
      : isBusy
      ? 'busy'
      : active
        ? 'active'
        : isConnected
          ? 'connected'
          : 'disconnected';

    this.command = (pendingAsTarget || pendingAsSource)
      ? undefined
      : isConnected
      ? {
        command: 'acp.openSession',
        title: 'Open Session',
        arguments: [connectedSession!.sessionId],
      }
      : {
        command: 'acp.openAgentTask',
        title: 'Open Task Session',
        arguments: [{ agentName: agentId, taskSessionId: task.sessionId }],
      };

    this.tooltip = [
      `Task session id: ${task.sessionId}`,
      `CWD: ${task.cwd}`,
      ...(task.updatedAt ? [`Updated: ${new Date(task.updatedAt).toLocaleString()}`] : []),
      `State: ${pendingAsSource ? 'disconnecting' : isBusy ? 'busy' : isConnected ? 'connected instance' : 'history only'}`,
    ].join('\n');
  }
}

class EmptyInstancesTreeItem extends vscode.TreeItem {
  constructor() {
    super('No instances', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'empty-instances';
    this.description = 'Create an instance to start chatting';
  }
}

class EmptyTasksTreeItem extends vscode.TreeItem {
  constructor() {
    super('No task history', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'empty-tasks';
    this.description = 'No ACP sessions listed';
  }
}

class LoadingTreeItem extends vscode.TreeItem {
  constructor(label: string = 'Loading...') {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'loading-item';
    this.iconPath = new vscode.ThemeIcon('loading~spin');
  }
}

class LoadMoreTasksTreeItem extends vscode.TreeItem {
  constructor(public readonly agentId: string) {
    super('Load more tasks', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'load-more-tasks';
    this.iconPath = new vscode.ThemeIcon('chevron-down');
    this.command = {
      command: 'acp.loadMoreAgentTasks',
      title: 'Load More Agent Tasks',
      arguments: [{ agentName: agentId }],
    };
  }
}

type TreeItem =
  | AgentTreeItem
  | SessionGroupTreeItem
  | SessionTreeItem
  | TaskSessionTreeItem
  | EmptyInstancesTreeItem
  | EmptyTasksTreeItem
  | LoadingTreeItem
  | LoadMoreTasksTreeItem;

type AgentBootstrapState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; supportsTaskHistory: false }
  | {
      status: 'ready';
      supportsTaskHistory: true;
      tasks: AcpListedSessionInfo[];
      nextCursor: string | null;
      loadingMore: boolean;
    };

/**
 * TreeDataProvider for the OACP Agents sidebar view.
 * Shows configured agents with connected session instances as children.
 */
export class SessionTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private bootstrapStateByAgent = new Map<string, AgentBootstrapState>();
  private inFlightBootstraps = new Map<string, Promise<void>>();

  constructor(private readonly sessionManager: SessionManager) {
    this.sessionManager.on('agent-connected', () => this.refresh());
    this.sessionManager.on('agent-disconnected', () => this.refresh());
    this.sessionManager.on('active-session-changed', () => this.refresh());
    this.sessionManager.on('busy-changed', () => this.refresh());
    this.sessionManager.on('task-switch-state-changed', () => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (
      element instanceof SessionTreeItem
      || element instanceof TaskSessionTreeItem
      || element instanceof EmptyInstancesTreeItem
      || element instanceof EmptyTasksTreeItem
      || element instanceof LoadingTreeItem
      || element instanceof LoadMoreTasksTreeItem
    ) {
      return [];
    }

    if (element instanceof AgentTreeItem) {
      const state = this.bootstrapStateByAgent.get(element.agentId) ?? { status: 'idle' as const };
      if (state.status !== 'ready') {
        this.ensureAgentBootstrap(element.agentId);
        return [new LoadingTreeItem('Loading sessions...')];
      }
      return [new SessionGroupTreeItem(element.agentId)];
    }

    if (element instanceof SessionGroupTreeItem) {
      const state = this.bootstrapStateByAgent.get(element.agentId);
      if (!state || state.status !== 'ready') {
        this.ensureAgentBootstrap(element.agentId);
        return [new LoadingTreeItem('Loading sessions...')];
      }

      const activeSessionId = this.sessionManager.getActiveSessionId();
      if (state.supportsTaskHistory) {
        const taskIds = new Set(state.tasks.map((task) => task.sessionId));
        const liveSessions = this.sessionManager.getSessionsForAgent(element.agentId);
        const nonHistoryLiveSessions = liveSessions
          .filter((session) =>
            !taskIds.has(session.sourceTaskSessionId ?? '')
            && !taskIds.has(session.sessionId),
          )
          .map((session) => new SessionTreeItem(session, session.sessionId === activeSessionId));

        const taskRows = state.tasks.map((task) => {
          const connected = this.sessionManager.getSessionForTask(element.agentId, task.sessionId);
          const pendingAsTarget = this.sessionManager.isTaskSwitchTargetPending(element.agentId, task.sessionId);
          const pendingAsSource = this.sessionManager.isTaskSwitchSourcePending(element.agentId, task.sessionId);
          return new TaskSessionTreeItem(
            element.agentId,
            task,
            connected,
            connected?.sessionId === activeSessionId,
            pendingAsTarget,
            pendingAsSource,
          );
        });
        if (nonHistoryLiveSessions.length > 0 || taskRows.length > 0) {
          // Keep ad-hoc live sessions visible at the top until/if they appear in task history.
          const rows: TreeItem[] = [...nonHistoryLiveSessions, ...taskRows];
          if (state.loadingMore) {
            rows.push(new LoadingTreeItem('Loading more tasks...'));
          } else if (state.nextCursor) {
            rows.push(new LoadMoreTasksTreeItem(element.agentId));
          }
          return rows;
        }
        if (state.loadingMore) {
          return [new LoadingTreeItem('Loading more tasks...')];
        }
        if (state.nextCursor) {
          return [new LoadMoreTasksTreeItem(element.agentId)];
        }
        return [new EmptyTasksTreeItem()];
      }

      const sessions = this.sessionManager
        .getSessionsForAgent(element.agentId)
        .map((session) => new SessionTreeItem(session, session.sessionId === activeSessionId));
      return sessions.length > 0 ? sessions : [new EmptyInstancesTreeItem()];
    }

    const agents = getAgentConfigs();
    return Object.entries(agents)
      .map(([id, config]) => {
        const sessions = this.sessionManager.getSessionsForAgent(id);
        return new AgentTreeItem(
          id,
          config.displayName || id,
          sessions.length > 0,
          sessions.some((session) => session.busy),
          sessions.length,
        );
      })
      .sort((left, right) => String(left.label).localeCompare(String(right.label)));
  }

  private ensureAgentBootstrap(agentId: string): void {
    if (this.inFlightBootstraps.has(agentId)) {
      return;
    }
    const existing = this.bootstrapStateByAgent.get(agentId);
    if (existing?.status === 'ready') {
      return;
    }

    this.bootstrapStateByAgent.set(agentId, { status: 'loading' });
    const loadPromise = (async () => {
      try {
        const firstPage = await this.sessionManager.listAgentTasksPage(agentId);
        if (firstPage === null) {
          this.bootstrapStateByAgent.set(agentId, {
            status: 'ready',
            supportsTaskHistory: false,
          });
          return;
        }

        this.bootstrapStateByAgent.set(agentId, {
          status: 'ready',
          supportsTaskHistory: true,
          tasks: firstPage.tasks,
          nextCursor: firstPage.nextCursor,
          loadingMore: false,
        });
      } catch {
        // Fail open: render original live-session mode on bootstrap errors.
        this.bootstrapStateByAgent.set(agentId, {
          status: 'ready',
          supportsTaskHistory: false,
        });
      } finally {
        this.inFlightBootstraps.delete(agentId);
        this.refresh();
      }
    })();

    this.inFlightBootstraps.set(agentId, loadPromise);
  }

  async loadMoreAgentTasks(agentId: string): Promise<void> {
    const state = this.bootstrapStateByAgent.get(agentId);
    if (!state || state.status !== 'ready' || !state.supportsTaskHistory || !state.nextCursor || state.loadingMore) {
      return;
    }

    const cursor = state.nextCursor;
    this.bootstrapStateByAgent.set(agentId, {
      ...state,
      loadingMore: true,
    });
    this.refresh();

    try {
      const page = await this.sessionManager.listAgentTasksPage(agentId, cursor);
      if (page === null) {
        this.bootstrapStateByAgent.set(agentId, {
          status: 'ready',
          supportsTaskHistory: false,
        });
        return;
      }

      const existingState = this.bootstrapStateByAgent.get(agentId);
      if (!existingState || existingState.status !== 'ready' || !existingState.supportsTaskHistory) {
        return;
      }

      const merged = [...existingState.tasks];
      const seen = new Set(merged.map((task) => task.sessionId));
      for (const task of page.tasks) {
        if (seen.has(task.sessionId)) {
          continue;
        }
        merged.push(task);
        seen.add(task.sessionId);
      }

      this.bootstrapStateByAgent.set(agentId, {
        status: 'ready',
        supportsTaskHistory: true,
        tasks: merged,
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
    } catch {
      const existingState = this.bootstrapStateByAgent.get(agentId);
      if (existingState && existingState.status === 'ready' && existingState.supportsTaskHistory) {
        this.bootstrapStateByAgent.set(agentId, {
          ...existingState,
          loadingMore: false,
        });
      }
    } finally {
      this.refresh();
    }
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
