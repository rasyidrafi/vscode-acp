import * as vscode from 'vscode';

export const SETTINGS_NAMESPACE = 'oacp';
const LEGACY_SETTINGS_NAMESPACE = 'acp';

interface ConfigurationInspect<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
  globalLanguageValue?: T;
  workspaceLanguageValue?: T;
  workspaceFolderLanguageValue?: T;
}

export function getSettings(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SETTINGS_NAMESPACE);
}

export function getSetting<T>(key: string, defaultValue: T): T {
  const currentConfig = getSettings();
  const currentInspect = currentConfig.inspect?.<T>(key);
  if (hasConfiguredValue(currentInspect)) {
    return currentConfig.get<T>(key, defaultValue);
  }

  return vscode.workspace.getConfiguration(LEGACY_SETTINGS_NAMESPACE).get<T>(key, defaultValue);
}

export function getAgentSettings(): Record<string, unknown> {
  const current = getSetting<Record<string, unknown>>('agents', {});
  if (Object.keys(current).length > 0) {
    return current;
  }

  const legacy = vscode.workspace.getConfiguration(LEGACY_SETTINGS_NAMESPACE).get<Record<string, unknown>>('agents', {});
  return legacy || {};
}

function hasConfiguredValue<T>(inspect: ConfigurationInspect<T> | undefined): boolean {
  return inspect?.globalValue !== undefined ||
    inspect?.workspaceValue !== undefined ||
    inspect?.workspaceFolderValue !== undefined ||
    inspect?.globalLanguageValue !== undefined ||
    inspect?.workspaceLanguageValue !== undefined ||
    inspect?.workspaceFolderLanguageValue !== undefined;
}
