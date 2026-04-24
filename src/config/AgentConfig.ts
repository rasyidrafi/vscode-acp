import * as vscode from 'vscode';

/**
 * Configuration for a single ACP agent.
 */
export interface AgentConfigEntry {
  /** Absolute path to a locally installed binary. Takes priority when set. */
  binaryPath?: string;
  /** Binary name to resolve from PATH when binaryPath is not set (e.g., "gemini"). */
  binaryName?: string;
  /** Command-line arguments for the resolved binary. */
  binaryArgs?: string[];
  /** NPX package to run (e.g., "@anthropic-ai/claude-code@latest") */
  command: string;
  /** Command-line arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Display name */
  displayName?: string;
}

/**
 * Read agent configurations from VS Code settings.
 * Returns a map of agent name → config.
 */
export function getAgentConfigs(): Record<string, AgentConfigEntry> {
  const config = vscode.workspace.getConfiguration('acp');
  const agents = config.get<Record<string, AgentConfigEntry>>('agents', {});
  return agents;
}

/**
 * Get the list of agent names available.
 */
export function getAgentNames(): string[] {
  return Object.keys(getAgentConfigs());
}

/**
 * Get a specific agent config by name.
 */
export function getAgentConfig(name: string): AgentConfigEntry | undefined {
  return getAgentConfigs()[name];
}
