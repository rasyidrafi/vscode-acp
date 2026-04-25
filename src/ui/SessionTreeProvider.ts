import * as vscode from 'vscode';
import { SessionInfo, SessionManager } from '../core/SessionManager';
import { getAgentConfigs, isConfigurableAgent } from '../config/AgentConfig';

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
    super(agentDisplayName, vscode.TreeItemCollapsibleState.Expanded);

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

/**
 * A tree item representing one connected session instance.
 */
class SessionTreeItem extends vscode.TreeItem {
  public readonly sessionId: string;

  constructor(
    public readonly session: SessionInfo,
    public readonly active: boolean,
  ) {
    const shortId = getShortSessionId(session.sessionId);
    super(active ? `Session ${shortId} (active)` : `Session ${shortId}`, vscode.TreeItemCollapsibleState.None);

    this.sessionId = session.sessionId;
    this.id = session.sessionId;
    this.contextValue = active ? 'session-active' : 'session-connected';
    this.iconPath = new vscode.ThemeIcon(
      session.busy ? 'sync~spin' : active ? 'record' : 'vm',
      new vscode.ThemeColor(session.busy || active ? 'testing.iconPassed' : 'foreground'),
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

class EmptyInstancesTreeItem extends vscode.TreeItem {
  constructor() {
    super('No instances', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'empty-instances';
    this.description = 'Create an instance to start chatting';
  }
}

type TreeItem = AgentTreeItem | SessionTreeItem | EmptyInstancesTreeItem;

/**
 * TreeDataProvider for the OACP Agents sidebar view.
 * Shows configured agents with connected session instances as children.
 */
export class SessionTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly sessionManager: SessionManager) {
    this.sessionManager.on('agent-connected', () => this.refresh());
    this.sessionManager.on('agent-disconnected', () => this.refresh());
    this.sessionManager.on('active-session-changed', () => this.refresh());
    this.sessionManager.on('busy-changed', () => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (element instanceof SessionTreeItem || element instanceof EmptyInstancesTreeItem) {
      return [];
    }

    if (element instanceof AgentTreeItem) {
      const activeSessionId = this.sessionManager.getActiveSessionId();
      const sessions = this.sessionManager
        .getSessionsForAgent(element.agentId)
        .map(session => new SessionTreeItem(session, session.sessionId === activeSessionId));
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
          sessions.some(session => session.busy),
          sessions.length,
        );
      })
      .sort((left, right) => String(left.label).localeCompare(String(right.label)));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

function getShortSessionId(sessionId: string): string {
  return sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8);
}
