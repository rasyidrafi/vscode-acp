import * as vscode from 'vscode';

import type { CommandServices } from './types';
import { registerConfigCommands } from './configCommands';
import { registerSessionCommands } from './sessionCommands';

export function registerCommands(services: CommandServices): vscode.Disposable[] {
  return [
    ...registerSessionCommands(services),
    ...registerConfigCommands(services),
  ];
}

export type { CommandServices } from './types';
