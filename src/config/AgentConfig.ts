import * as vscode from 'vscode';
import { logError } from '../utils/Logger';
import type { RegistryAgent } from './RegistryClient';

/**
 * Configuration for a single ACP agent.
 */
export interface AgentConfigEntry {
  /** Stable agent id from the ACP registry. */
  id?: string;
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
  /** Registry version captured when the agent was added. */
  registryVersion?: string;
}

type UnknownRecord = Record<string, unknown>;

/**
 * Read agent configurations from VS Code settings.
 * Returns a map of registry id to added-agent config.
 */
export function getAgentConfigs(): Record<string, AgentConfigEntry> {
  const config = vscode.workspace.getConfiguration('acp');
  const agents = config.get<Record<string, unknown>>('agents', {});
  return sanitizeAgentConfigs(agents);
}

/**
 * Get a specific added agent config by registry id.
 */
export function getAgentConfig(agentId: string): AgentConfigEntry | undefined {
  return getAgentConfigs()[agentId];
}

export function getAgentDisplayName(agentId: string): string {
  return getAgentConfig(agentId)?.displayName || agentId;
}

export function getAgentQuickPickItems(): Array<vscode.QuickPickItem & { agentId: string }> {
  return Object.entries(getAgentConfigs())
    .map(([agentId, config]) => ({
      label: config.displayName || agentId,
      description: agentId,
      detail: config.registryVersion ? `Registry version ${config.registryVersion}` : undefined,
      agentId,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function sanitizeAgentConfigs(value: Record<string, unknown>): Record<string, AgentConfigEntry> {
  const sanitized: Record<string, AgentConfigEntry> = {};

  for (const [name, rawConfig] of Object.entries(value)) {
    const config = sanitizeAgentConfig(rawConfig);
    if (!config) {
      logError(`Ignoring invalid ACP agent config: ${name}`);
      continue;
    }
    sanitized[name] = config;
  }

  return sanitized;
}

function sanitizeAgentConfig(value: unknown): AgentConfigEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const command = optionalString(value.command);
  const id = optionalString(value.id);
  const binaryPath = optionalString(value.binaryPath);
  const binaryName = optionalString(value.binaryName);
  const args = stringArray(value.args);
  const binaryArgs = stringArray(value.binaryArgs);
  const env = stringRecord(value.env);
  const displayName = optionalString(value.displayName);
  const registryVersion = optionalString(value.registryVersion);

  if (!command && !binaryPath && !binaryName) {
    return null;
  }

  return {
    command: command ?? '',
    ...(id ? { id } : {}),
    ...(binaryPath ? { binaryPath } : {}),
    ...(binaryName ? { binaryName } : {}),
    ...(binaryArgs.length > 0 ? { binaryArgs } : {}),
    ...(args.length > 0 ? { args } : {}),
    ...(env ? { env } : {}),
    ...(displayName ? { displayName } : {}),
    ...(registryVersion ? { registryVersion } : {}),
  };
}

export function createAgentConfigFromRegistry(agent: RegistryAgent): AgentConfigEntry | null {
  const npx = agent.distribution?.npx;
  const command = agent.command || (npx ? 'npx' : undefined);
  const args = agent.args || (npx ? [npx.package, ...(npx.args || [])] : undefined);
  const env = npx?.env;

  if (!command) {
    return null;
  }

  const config: AgentConfigEntry = {
    id: agent.id,
    displayName: agent.name,
    registryVersion: agent.version,
    command,
    ...(args && args.length > 0 ? { args } : {}),
    ...(env ? { env } : {}),
  };

  if (agent.id === 'gemini') {
    config.binaryName = 'gemini';
    config.binaryArgs = ['--acp'];
    config.binaryPath = '';
  }

  if (agent.id === 'github-copilot-cli') {
    config.binaryName = 'copilot';
    config.binaryArgs = ['--acp'];
    config.binaryPath = '';
  }

  return config;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter((entry): entry is [string, string] => (
    typeof entry[1] === 'string'
  ));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}
