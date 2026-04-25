import * as vscode from 'vscode';
import { SessionManager } from '../core/SessionManager';
import { getAgentConfigs, isConfigurableAgent } from '../config/AgentConfig';

/**
 * A flat tree item representing a configured agent.
 * Shows connected/disconnected state with appropriate icon.
 */
class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly agentId: string,
    public readonly agentDisplayName: string,
    public readonly connected: boolean,
    public readonly active: boolean,
    public readonly busy: boolean,
  ) {
    super(agentDisplayName, vscode.TreeItemCollapsibleState.None);

    if (active) {
      this.label = `${agentDisplayName} (active)`;
      this.contextValue = isConfigurableAgent(agentId) ? 'agent-active-configurable' : 'agent-active';
      this.iconPath = new vscode.ThemeIcon(
        busy ? 'sync~spin' : 'record',
        new vscode.ThemeColor(busy ? 'notificationsInfoIconForeground' : 'testing.iconPassed'),
      );
      this.description = busy ? 'busy' : 'active';
    } else if (connected) {
      this.contextValue = isConfigurableAgent(agentId) ? 'agent-connected-configurable' : 'agent-connected';
      this.iconPath = new vscode.ThemeIcon(
        busy ? 'sync~spin' : 'circle-filled',
        new vscode.ThemeColor(busy ? 'notificationsInfoIconForeground' : 'testing.iconPassed'),
      );
      this.description = busy ? 'busy' : 'connected';
    } else {
      this.contextValue = isConfigurableAgent(agentId) ? 'agent-disconnected-configurable' : 'agent-disconnected';
      this.iconPath = new vscode.ThemeIcon('circle-outline');
      this.description = '';
    }

    if (connected) {
      // Click to switch/focus
      this.command = {
        command: 'acp.connectAgent',
        title: 'Switch to Agent',
        arguments: [agentId],
      };
    }

    this.tooltip = connected
      ? `${agentDisplayName} — ${busy ? 'busy' : 'connected'}\nRegistry id: ${agentId}\nClick to open chat`
      : `${agentDisplayName} — not connected\nRegistry id: ${agentId}\nUse the plug icon to connect`;
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

    const agents = getAgentConfigs();
    const activeAgent = this.sessionManager.getActiveAgentName();

    return Object.entries(agents)
      .map(([id, config]) => new AgentTreeItem(
        id,
        config.displayName || id,
        this.sessionManager.isAgentConnected(id),
        activeAgent === id,
        this.sessionManager.isAgentBusy(id),
      ))
      .sort((left, right) => String(left.label).localeCompare(String(right.label)));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
