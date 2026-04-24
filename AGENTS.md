# ACP Client Notes

## What This Project Is

VS Code extension for connecting to ACP-compatible coding agents. It spawns an agent process, talks ACP JSON-RPC over stdio, and renders chat in a React webview.

## Core Flow

1. `src/extension.ts` activates the extension, creates services, registers views, and delegates command registration.
2. User connects through `acp.connectAgent`.
3. `SessionManager` reads the selected agent config and enforces one active agent at a time.
4. `AgentManager` spawns the configured agent process.
5. `ConnectionManager` wraps the process stdin/stdout with ACP `ndJsonStream`.
6. ACP `initialize` and `newSession` create the working session.
7. Chat prompts go through `SessionManager.sendPrompt`.
8. Agent streaming output arrives as ACP `session/update` notifications.
9. `SessionUpdateHandler` normalizes raw ACP updates through `src/shared/acpAdapters.ts`.
10. `ChatWebviewProvider` forwards normalized updates over the bridge to the React webview.
11. The webview persists its own transcript state with `vscode.setState()` and reports `stateSync` back to the extension so session-switch confirmations use synchronized chat-content state.

## Key Files

- `src/extension.ts`: activation, service composition, UI wiring.
- `src/commands/*`: command registration split by domain.
- `src/commands/sessionCommands.ts`: connect/disconnect/chat/session actions.
- `src/commands/configCommands.ts`: add/remove agent and registry actions.
- `src/core/SessionManager.ts`: active agent/session lifecycle, prompts, cancel, mode/model changes.
- `src/core/AgentManager.ts`: resolves launch config and spawns/kills agent processes.
- `src/core/ConnectionManager.ts`: ACP connection setup, initialization, traffic logging.
- `src/core/AcpClientImpl.ts`: client-side ACP methods exposed back to agents.
- `src/handlers/*`: file system, terminal, permission, and session update handling.
- `src/ui/ChatWebviewProvider.ts`: VS Code webview bridge and chat command handling.
- `src/shared/acpAdapters.ts`: ACP payload normalization for extension and webview.
- `webview/*`: React chat UI and reducer-based timeline state.
- `src/shared/bridge.ts`: typed message contract between extension and webview.

## Agent Config

Agent definitions come from `acp.agents` in VS Code settings. Launch priority:

1. `binaryPath`
2. `binaryName` resolved from `PATH`
3. fallback `command` plus `args`

Configs are sanitized on read in `src/config/AgentConfig.ts`. Invalid entries are ignored instead of being trusted blindly.

Default agents are declared in `package.json`.

`acp.addAgent` now parses arguments with shell-style quoting rather than splitting on whitespace.

## Webview Messages

Webview to extension:

- `ready`
- `stateSync`
- `sendPrompt`
- `cancelTurn`
- `setMode`
- `setModel`
- `executeCommand`
- `clearError`

Extension to webview:

- `state`
- `sessionUpdate`
- `promptStart`
- `promptEnd`
- `error`
- `clearChat`
- `fileAttached`
- `modesUpdate`
- `modelsUpdate`

## Important Notes

- User-facing model is one connected agent, though ACP sessions are used internally.
- Agent responses are rendered mostly from normalized `sessionUpdate`, not only the final prompt response.
- File attachment currently prepends file paths into prompt text; it is not structured ACP attachment handling.
- Terminal capability runs real child processes and mirrors output into VS Code terminals.
- Agent and ACP terminal execution now prefer direct process spawning instead of shell execution by default.
- Webview command execution is allowlisted in `ChatWebviewProvider`.
- Webview transcript persistence uses `vscode.setState()`; the extension no longer relies on `retainContextWhenHidden` as the primary source of truth.
- ACP file writes are editor-aware. Open documents are updated through `WorkspaceEdit`, and automatic opening in the editor is controlled by `acp.autoOpenWrittenFilesInEditor`.
- Protocol traffic is logged through the `ACP Traffic` output channel when `acp.logTraffic` is enabled.
- Telemetry initialization is stateful (`enabled` / `disabled` / `degraded`) and respects `vscode.env.isTelemetryEnabled`.
- Registry fetches return structured results that distinguish fresh data, stale cached data, and failure.

## Settings

- `acp.agents`: configured agent definitions.
- `acp.autoApprovePermissions`: permission prompt behavior.
- `acp.defaultWorkingDirectory`: default session cwd override.
- `acp.autoOpenWrittenFilesInEditor`: auto-reveal ACP-written files in the editor.
- `acp.logTraffic`: ACP traffic logging toggle.

## Testing Focus

- Unit coverage now includes core lifecycle (`SessionManager`, `ConnectionManager`, `AgentManager`), handler behavior (`FileSystemHandler`, `TerminalHandler`), shared adapters, config/registry utilities, telemetry state handling, command arg parsing, and selected UI bridge behavior.
- `src/test/extension.test.ts` remains the lightweight VS Code integration smoke test for activation and command registration.

## Build/Test

- `npm run compile`: build extension and webview.
- `npm run typecheck`: TypeScript checks for both targets.
- `npm run test:unit`: Vitest unit tests.
- `npm test`: VS Code extension tests.
- `npm run package`: production build.
