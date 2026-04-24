# ACP Client Notes

## What This Project Is

VS Code extension for connecting to ACP-compatible coding agents. It spawns an agent process, talks ACP JSON-RPC over stdio, and renders chat in a React webview.

## Core Flow

1. `src/extension.ts` activates the extension, creates services, registers views, and wires commands.
2. User connects through `acp.connectAgent`.
3. `SessionManager` reads the selected agent config and enforces one active agent at a time.
4. `AgentManager` spawns the configured agent process.
5. `ConnectionManager` wraps the process stdin/stdout with ACP `ndJsonStream`.
6. ACP `initialize` and `newSession` create the working session.
7. Chat prompts go through `SessionManager.sendPrompt`.
8. Agent streaming output arrives as ACP `sessionUpdate` notifications and is forwarded to the webview.

## Key Files

- `src/extension.ts`: activation, command registration, service wiring.
- `src/core/SessionManager.ts`: active agent/session lifecycle, prompts, cancel, mode/model changes.
- `src/core/AgentManager.ts`: resolves launch config and spawns/kills agent processes.
- `src/core/ConnectionManager.ts`: ACP connection setup, initialization, traffic logging.
- `src/core/AcpClientImpl.ts`: client-side ACP methods exposed back to agents.
- `src/handlers/*`: file system, terminal, permission, and session update handling.
- `src/ui/ChatWebviewProvider.ts`: VS Code webview bridge and chat command handling.
- `webview/*`: React chat UI and reducer-based timeline state.
- `src/shared/bridge.ts`: typed message contract between extension and webview.

## Agent Config

Agent definitions come from `acp.agents` in VS Code settings. Launch priority:

1. `binaryPath`
2. `binaryName` resolved from `PATH`
3. fallback `command` plus `args`

Default agents are declared in `package.json`.

## Webview Messages

Webview to extension:

- `ready`
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
- Agent responses are rendered mostly from `sessionUpdate`, not only the final prompt response.
- File attachment currently prepends file paths into prompt text; it is not structured ACP attachment handling.
- Terminal capability runs real child processes and mirrors output into VS Code terminals.
- Webview command execution is allowlisted in `ChatWebviewProvider`.
- Protocol traffic is logged through the `ACP Traffic` output channel when `acp.logTraffic` is enabled.

## Build/Test

- `npm run compile`: build extension and webview.
- `npm run typecheck`: TypeScript checks for both targets.
- `npm run test:unit`: Vitest unit tests.
- `npm test`: VS Code extension tests.
- `npm run package`: production build.
