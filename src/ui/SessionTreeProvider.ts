import * as vscode from 'vscode';
import { SessionManager } from '../core/SessionManager';
import { getAgentNames } from '../config/AgentConfig';

/**
 * A flat tree item representing a configured agent.
 * Shows connected/disconnected state with appropriate icon.
 */
class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly agentName: string,
    public readonly connected: boolean,
    public readonly active: boolean,
    public readonly busy: boolean,
  ) {
    super(agentName, vscode.TreeItemCollapsibleState.None);

    if (active) {
      this.label = `${agentName} (active)`;
      this.contextValue = 'agent-active';
      this.iconPath = new vscode.ThemeIcon(
        busy ? 'sync~spin' : 'record',
        new vscode.ThemeColor(busy ? 'notificationsInfoIconForeground' : 'testing.iconPassed'),
      );
      this.description = busy ? 'busy' : 'active';
    } else if (connected) {
      this.contextValue = 'agent-connected';
      this.iconPath = new vscode.ThemeIcon(
        busy ? 'sync~spin' : 'circle-filled',
        new vscode.ThemeColor(busy ? 'notificationsInfoIconForeground' : 'testing.iconPassed'),
      );
      this.description = busy ? 'busy' : 'connected';
    } else {
      this.contextValue = 'agent-disconnected';
      this.iconPath = new vscode.ThemeIcon('circle-outline');
      this.description = '';
    }

    if (connected) {
      // Click to switch/focus
      this.command = {
        command: 'acp.connectAgent',
        title: 'Switch to Agent',
        arguments: [agentName],
      };
    }

    this.tooltip = connected
      ? `${agentName} — ${busy ? 'busy' : 'connected'}\nClick to open chat`
      : `${agentName} — not connected\nUse the plug icon to connect`;
  }
}

/**
 * TreeDataProvider for the OACP Agents sidebar view.
 * Shows a flat list of configured agents with connected/disconnected state.
 */
export class SessionTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | null | void>();
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

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AgentTreeItem): AgentTreeItem[] {
    if (element) { return []; } // flat list, no children

    const agentNames = getAgentNames();
    const activeAgent = this.sessionManager.getActiveAgentName();

    return agentNames.map(name => new AgentTreeItem(
      name,
      this.sessionManager.isAgentConnected(name),
      activeAgent === name,
      this.sessionManager.isAgentBusy(name),
    ));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
