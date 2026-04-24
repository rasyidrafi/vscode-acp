import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyEditMock,
  readFileMock,
  writeFileMock,
  createDirectoryMock,
  openTextDocumentMock,
  showTextDocumentMock,
  getConfigurationMock,
  MockWorkspaceEdit,
} = vi.hoisted(() => {
  class HoistedWorkspaceEdit {
    public replacements: Array<{ uri: { fsPath: string }; text: string }> = [];

    replace(uri: { fsPath: string }, _range: unknown, text: string): void {
      this.replacements.push({ uri, text });
    }
  }

  return {
    applyEditMock: vi.fn(),
    readFileMock: vi.fn(),
    writeFileMock: vi.fn(),
    createDirectoryMock: vi.fn(),
    openTextDocumentMock: vi.fn(),
    showTextDocumentMock: vi.fn(),
    getConfigurationMock: vi.fn(() => ({
      get: vi.fn(() => false),
    })),
    MockWorkspaceEdit: HoistedWorkspaceEdit,
  };
});

vi.mock('vscode', () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
  Range: class {
    constructor(
      public readonly start: unknown,
      public readonly end: unknown,
    ) {}
  },
  WorkspaceEdit: MockWorkspaceEdit,
  workspace: {
    textDocuments: [],
    getConfiguration: getConfigurationMock,
    applyEdit: applyEditMock,
    openTextDocument: openTextDocumentMock,
    fs: {
      readFile: readFileMock,
      writeFile: writeFileMock,
      createDirectory: createDirectoryMock,
    },
  },
  window: {
    showTextDocument: showTextDocumentMock,
  },
}));

vi.mock('../utils/Logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

import { FileSystemHandler } from './FileSystemHandler';

describe('FileSystemHandler', () => {
  beforeEach(async () => {
    applyEditMock.mockReset();
    readFileMock.mockReset();
    writeFileMock.mockReset();
    createDirectoryMock.mockReset();
    openTextDocumentMock.mockReset();
    showTextDocumentMock.mockReset();
    getConfigurationMock.mockReset();
    getConfigurationMock.mockReturnValue({
      get: vi.fn(() => false),
    });

    const vscode = await import('vscode');
    (vscode.workspace.textDocuments as unknown[]) = [];
  });

  it('updates open editor buffers through WorkspaceEdit', async () => {
    const vscode = await import('vscode');
    const openDoc = {
      uri: { fsPath: '/workspace/src/app.ts' },
      getText: vi.fn(() => 'old content'),
      positionAt: vi.fn((offset: number) => ({ offset })),
    };
    (vscode.workspace.textDocuments as unknown[]) = [openDoc];
    applyEditMock.mockResolvedValue(true);
    const handler = new FileSystemHandler();
    await handler.writeTextFile({
      sessionId: 'session-1',
      path: '/workspace/src/app.ts',
      content: 'new content',
    });

    expect(applyEditMock).toHaveBeenCalledTimes(1);
    const [edit] = applyEditMock.mock.calls[0];
    expect(edit.replacements).toEqual([
      {
        uri: { fsPath: '/workspace/src/app.ts' },
        text: 'new content',
      },
    ]);
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(createDirectoryMock).not.toHaveBeenCalled();
    expect(showTextDocumentMock).not.toHaveBeenCalled();
  });

  it('creates parent directories before writing unopened files', async () => {
    const handler = new FileSystemHandler();
    await handler.writeTextFile({
      sessionId: 'session-1',
      path: '/workspace/new/file.ts',
      content: 'hello',
    });

    expect(createDirectoryMock).toHaveBeenCalledWith({ fsPath: '/workspace/new' });
    expect(writeFileMock).toHaveBeenCalledWith(
      { fsPath: '/workspace/new/file.ts' },
      Buffer.from('hello', 'utf-8'),
    );
    expect(openTextDocumentMock).not.toHaveBeenCalled();
    expect(showTextDocumentMock).not.toHaveBeenCalled();
  });

  it('opens the file in the editor when auto-open is enabled', async () => {
    const doc = { uri: { fsPath: '/workspace/new/file.ts' } };
    openTextDocumentMock.mockResolvedValue(doc);
    showTextDocumentMock.mockResolvedValue(undefined);
    getConfigurationMock.mockReturnValue({
      get: vi.fn((key: string, defaultValue?: boolean) => (
        key === 'autoOpenWrittenFilesInEditor' ? true : defaultValue
      )),
    });

    const handler = new FileSystemHandler();
    await handler.writeTextFile({
      sessionId: 'session-1',
      path: '/workspace/new/file.ts',
      content: 'hello',
    });

    expect(openTextDocumentMock).toHaveBeenCalledWith({ fsPath: '/workspace/new/file.ts' });
    expect(showTextDocumentMock).toHaveBeenCalledWith(doc, {
      preview: true,
      preserveFocus: true,
    });
  });
});
