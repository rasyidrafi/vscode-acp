import * as vscode from 'vscode';

import { SessionManager } from '../core/SessionManager';
import { SessionTreeProvider } from '../ui/SessionTreeProvider';
import { ChatWebviewProvider } from '../ui/ChatWebviewProvider';

export interface CommandServices {
  sessionManager: SessionManager;
  sessionTreeProvider: SessionTreeProvider;
  chatWebviewProvider: ChatWebviewProvider;
}

export interface AgentCommandTarget {
  agentName?: string;
  agentId?: string;
  sessionId?: string;
}

export function getAgentName(target: string | AgentCommandTarget | undefined): string | undefined {
  if (typeof target === 'string') {
    return target;
  }
  return target?.agentName ?? target?.agentId;
}

export function getSessionId(target: string | AgentCommandTarget | undefined): string | undefined {
  if (typeof target === 'string') {
    return target;
  }
  return target?.sessionId;
}

export function registerCommand(
  command: string,
  callback: (...args: never[]) => unknown,
): vscode.Disposable {
  return vscode.commands.registerCommand(command, callback);
}

export function registerTypedCommand<Args extends unknown[]>(
  command: string,
  callback: (...args: Args) => unknown,
): vscode.Disposable {
  return vscode.commands.registerCommand(command, callback);
}
