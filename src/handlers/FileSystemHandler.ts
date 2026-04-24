import * as vscode from 'vscode';
import { dirname } from 'node:path';
import { log, logError } from '../utils/Logger';

import type {
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';

/**
 * Handles ACP file system requests using VS Code's workspace filesystem API.
 * This gives us access to unsaved editor buffers automatically.
 */
export class FileSystemHandler {

  /**
   * Read a text file. Uses VS Code API to include unsaved editor content.
   */
  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    log(`readTextFile: ${params.path}`);

    try {
      const uri = vscode.Uri.file(params.path);

      // Check if the file is open in an editor with unsaved changes
      const openDoc = vscode.workspace.textDocuments.find(
        doc => doc.uri.fsPath === uri.fsPath
      );

      let content: string;
      if (openDoc) {
        content = openDoc.getText();
      } else {
        const raw = await vscode.workspace.fs.readFile(uri);
        content = Buffer.from(raw).toString('utf-8');
      }

      // Handle line/limit parameters
      if (params.line !== undefined && params.line !== null
        || params.limit !== undefined && params.limit !== null) {
        const lines = content.split('\n');
        const startLine = (params.line ?? 1) - 1; // 1-based → 0-based
        const endLine = params.limit
          ? startLine + params.limit
          : lines.length;
        content = lines.slice(startLine, endLine).join('\n');
      }

      return { content };
    } catch (e) {
      logError(`readTextFile failed: ${params.path}`, e);
      throw e;
    }
  }

  /**
   * Write a text file. If the file is open, update the editor buffer so VS Code
   * keeps the document dirty state. Otherwise create parent directories and
   * write to disk, then reveal the file in the editor.
   */
  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    log(`writeTextFile: ${params.path}`);

    try {
      const uri = vscode.Uri.file(params.path);
      const config = vscode.workspace.getConfiguration('acp');
      const autoOpenInEditor = config.get<boolean>('autoOpenWrittenFilesInEditor', false);
      const openDoc = vscode.workspace.textDocuments.find(
        doc => doc.uri.fsPath === uri.fsPath
      );

      if (openDoc) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          openDoc.positionAt(0),
          openDoc.positionAt(openDoc.getText().length),
        );
        edit.replace(uri, fullRange, params.content);

        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
          throw new Error(`Failed to update open document: ${params.path}`);
        }
      } else {
        const encoded = Buffer.from(params.content, 'utf-8');
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirname(params.path)));
        await vscode.workspace.fs.writeFile(uri, encoded);
      }

      if (autoOpenInEditor) {
        const doc = openDoc ?? await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
      }

      return {};
    } catch (e) {
      logError(`writeTextFile failed: ${params.path}`, e);
      throw e;
    }
  }
}
