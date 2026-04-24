import * as vscode from 'vscode';

export interface ChatWebviewHtmlOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  devServerUrl?: string;
}

export function getChatWebviewHtml(options: ChatWebviewHtmlOptions): string {
  const nonce = getNonce();
  const devServerUrl = options.devServerUrl?.replace(/\/$/, '');

  if (devServerUrl) {
    return getDevServerHtml(options.webview, devServerUrl, nonce);
  }

  const scriptUri = options.webview.asWebviewUri(
    vscode.Uri.joinPath(options.extensionUri, 'dist', 'webview', 'assets', 'index.js'),
  );
  const stylesUri = options.webview.asWebviewUri(
    vscode.Uri.joinPath(options.extensionUri, 'dist', 'webview', 'assets', 'index.css'),
  );

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.webview.cspSource} https: data:; style-src ${options.webview.cspSource}; font-src ${options.webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>ACP Chat</title>
  <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

function getDevServerHtml(webview: vscode.Webview, devServerUrl: string, nonce: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${devServerUrl}; img-src ${webview.cspSource} ${devServerUrl} https: data:; style-src ${webview.cspSource} ${devServerUrl} 'unsafe-inline'; font-src ${webview.cspSource} ${devServerUrl}; script-src 'nonce-${nonce}' ${devServerUrl};">
  <title>ACP Chat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${devServerUrl}/@vite/client"></script>
  <script nonce="${nonce}" type="module" src="${devServerUrl}/main.tsx"></script>
</body>
</html>`;
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
