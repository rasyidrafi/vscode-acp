# Improvement Review

## Scope

Reviewed the extension activation flow, agent/session lifecycle, ACP connection layer, handlers, webview state management, and existing tests.

Checks run during review:

- `npm run typecheck` ✅
- `npm run test:unit` ✅
- `npm test` reached build/lint successfully; the VS Code integration test runner was still downloading the VS Code runtime during this review

## Highest-Value Improvements

### 1. Fix `SessionManager` listener leaks and duplicate lifecycle handling

**Why it matters**

`SessionManager.connectToAgent()` attaches fresh `agent-error` and `agent-closed` listeners every time a connection is created, but those listeners are never removed. Reconnecting repeatedly will accumulate stale listeners, duplicate event handling, and eventually memory leak warnings.

**Evidence**

- [src/core/SessionManager.ts](/home/muhammandrafi25/Projects/vscode-acp/src/core/SessionManager.ts:93)
- [src/core/SessionManager.ts](/home/muhammandrafi25/Projects/vscode-acp/src/core/SessionManager.ts:100)

**What to change**

- Register `AgentManager` listeners once in the `SessionManager` constructor.
- Route events by `agentId` through a session lookup map instead of capturing `agentName` in per-connection closures.
- Make disconnect/close cleanup idempotent so explicit disconnects and process exits cannot double-fire state changes.

### 2. Dispose connection-scoped handlers instead of dropping references

**Why it matters**

`ConnectionManager.connect()` creates a new `FileSystemHandler`, `TerminalHandler`, `PermissionHandler`, and `AcpClientImpl` per connection. `removeConnection()` and `dispose()` only delete the map entry; they do not dispose connection-owned resources. That means ACP-created terminals and child processes can outlive the connection that created them.

**Evidence**

- [src/core/ConnectionManager.ts](/home/muhammandrafi25/Projects/vscode-acp/src/core/ConnectionManager.ts:52)
- [src/core/ConnectionManager.ts](/home/muhammandrafi25/Projects/vscode-acp/src/core/ConnectionManager.ts:103)
- [src/core/ConnectionManager.ts](/home/muhammandrafi25/Projects/vscode-acp/src/core/ConnectionManager.ts:107)
- [src/handlers/TerminalHandler.ts](/home/muhammandrafi25/Projects/vscode-acp/src/handlers/TerminalHandler.ts:228)

**What to change**

- Store disposable handlers inside `ConnectionInfo`.
- Add a real `disposeConnection(agentId)` path that disposes the ACP client, terminal handler, and any pipe/tap resources.
- Call that disposal from both explicit disconnects and process-close cleanup.

### 3. Remove `shell: true` from agent-command and terminal execution paths by default

**Why it matters**

The code currently sends ACP terminal commands and Windows/non-Windows agent launches through a shell. That introduces quoting differences, cross-platform inconsistency, and avoidable command-injection surface area for data that is already separated into `command` plus `args`.

**Evidence**

- [src/core/AgentManager.ts](/home/muhammandrafi25/Projects/vscode-acp/src/core/AgentManager.ts:142)
- [src/handlers/TerminalHandler.ts](/home/muhammandrafi25/Projects/vscode-acp/src/handlers/TerminalHandler.ts:53)

**What to change**

- Prefer direct `spawn(command, args, { shell: false })`.
- Keep shell wrapping only for explicit cases that truly require it, and isolate that decision in one launcher utility.
- Add tests for quoted args, paths with spaces, and Windows command resolution.

### 4. Make file writes editor-aware instead of writing straight to disk

**Why it matters**

`readTextFile()` correctly prefers unsaved open buffers, but `writeTextFile()` goes directly to `workspace.fs.writeFile()`. That bypasses the editor state model and can drift from dirty/open documents. The comment also says parent directories are created, but the implementation does not do that.

**Evidence**

- [src/handlers/FileSystemHandler.ts](/home/muhammandrafi25/Projects/vscode-acp/src/handlers/FileSystemHandler.ts:26)
- [src/handlers/FileSystemHandler.ts](/home/muhammandrafi25/Projects/vscode-acp/src/handlers/FileSystemHandler.ts:58)
- [src/handlers/FileSystemHandler.ts](/home/muhammandrafi25/Projects/vscode-acp/src/handlers/FileSystemHandler.ts:68)

**What to change**

- If the file is open, update it through `WorkspaceEdit` or the text document API.
- Create parent directories explicitly before disk writes.
- Decide and document whether ACP writes should preserve dirty buffers, replace them, or fail with a conflict.

### 5. Replace `any`/unchecked ACP payload handling with typed protocol adapters

**Why it matters**

The codebase handles several ACP updates and experimental model APIs via `as any` and unchecked property access. That works until the protocol evolves. It also makes reducer behavior and extension/webview synchronization harder to test confidently.

**Evidence**

- [src/core/SessionManager.ts](/home/muhammandrafi25/Projects/vscode-acp/src/core/SessionManager.ts:299)
- [src/core/SessionManager.ts](/home/muhammandrafi25/Projects/vscode-acp/src/core/SessionManager.ts:376)
- [src/ui/ChatWebviewProvider.ts](/home/muhammandrafi25/Projects/vscode-acp/src/ui/ChatWebviewProvider.ts:123)
- [src/handlers/SessionUpdateHandler.ts](/home/muhammandrafi25/Projects/vscode-acp/src/handlers/SessionUpdateHandler.ts:23)
- [webview/state.logic.ts](/home/muhammandrafi25/Projects/vscode-acp/webview/state.logic.ts:128)
- [webview/state.logic.ts](/home/muhammandrafi25/Projects/vscode-acp/webview/state.logic.ts:315)

**What to change**

- Introduce a small `acpAdapters.ts` layer that narrows raw SDK payloads into discriminated unions used by both extension and webview.
- Wrap experimental methods behind capability checks instead of calling them via `as any`.
- Reject unknown payload shapes centrally and log them with structured diagnostics.

### 6. Reduce state duplication between extension and webview

**Why it matters**

The extension tracks `_hasChatContent` separately from the webview timeline, while the webview also persists its own state via `vscode.setState()` and the view uses `retainContextWhenHidden`. These overlapping sources of truth are prone to drift. A concrete example: after a reload/restore, the webview can still show messages while `_hasChatContent` is `false`, so agent-switch/new-conversation confirmations can be skipped incorrectly.

**Evidence**

- [src/extension.ts](/home/muhammandrafi25/Projects/vscode-acp/src/extension.ts:46)
- [src/extension.ts](/home/muhammandrafi25/Projects/vscode-acp/src/extension.ts:105)
- [src/ui/ChatWebviewProvider.ts](/home/muhammandrafi25/Projects/vscode-acp/src/ui/ChatWebviewProvider.ts:20)
- [src/ui/ChatWebviewProvider.ts](/home/muhammandrafi25/Projects/vscode-acp/src/ui/ChatWebviewProvider.ts:83)
- [webview/bridge.ts](/home/muhammandrafi25/Projects/vscode-acp/webview/bridge.ts:21)
- [webview/state.ts](/home/muhammandrafi25/Projects/vscode-acp/webview/state.ts:35)

**What to change**

- Pick one persistence strategy: retained webview context or serialized `setState()`, not both unless there is a strong reason.
- Derive “has chat content” from synchronized state instead of a private boolean on the extension side.
- Consider moving timeline ownership fully into the extension if multi-session support is planned.

### 7. Break up `extension.ts` into command and composition modules

**Why it matters**

`src/extension.ts` currently does activation, service composition, event wiring, and every command implementation in one file. That makes command behavior harder to test and encourages more `any`-typed command payloads.

**Evidence**

- [src/extension.ts](/home/muhammandrafi25/Projects/vscode-acp/src/extension.ts:15)
- [src/extension.ts](/home/muhammandrafi25/Projects/vscode-acp/src/extension.ts:79)
- [src/extension.ts](/home/muhammandrafi25/Projects/vscode-acp/src/extension.ts:292)
- [src/extension.ts](/home/muhammandrafi25/Projects/vscode-acp/src/extension.ts:324)

**What to change**

- Move command implementations into a `commands/` folder with one module per command group.
- Introduce a typed `Services` container passed into registration functions.
- Replace `item?: any` command parameters with explicit tree item types or command argument interfaces.

### 8. Improve configuration UX and validation

**Why it matters**

Agent config editing is currently stringly typed. `acp.addAgent` splits args on whitespace, which breaks quoted arguments. Mode/model switching also falls back to free-form `showInputBox()` even when the session already advertises structured choices.

**Evidence**

- [src/extension.ts](/home/muhammandrafi25/Projects/vscode-acp/src/extension.ts:243)
- [src/extension.ts](/home/muhammandrafi25/Projects/vscode-acp/src/extension.ts:263)
- [src/extension.ts](/home/muhammandrafi25/Projects/vscode-acp/src/extension.ts:307)
- [src/extension.ts](/home/muhammandrafi25/Projects/vscode-acp/src/extension.ts:312)
- [src/config/AgentConfig.ts](/home/muhammandrafi25/Projects/vscode-acp/src/config/AgentConfig.ts:22)

**What to change**

- Validate agent configs on read with a schema library already in the dependency tree.
- Use pickers for advertised modes/models first, with manual entry as a fallback only.
- Parse command arguments with a shellwords/parser utility or collect them as repeated inputs.

### 9. Harden telemetry and registry error handling

**Why it matters**

Telemetry is initialized from a hard-coded connection string, and registry fetch errors are silently converted into cached/empty results. That makes operational behavior harder to reason about and harder to disable cleanly in some environments.

**Evidence**

- [src/utils/TelemetryManager.ts](/home/muhammandrafi25/Projects/vscode-acp/src/utils/TelemetryManager.ts:4)
- [src/config/RegistryClient.ts](/home/muhammandrafi25/Projects/vscode-acp/src/config/RegistryClient.ts:31)
- [src/config/RegistryClient.ts](/home/muhammandrafi25/Projects/vscode-acp/src/config/RegistryClient.ts:42)

**What to change**

- Centralize networked services behind explicit “enabled/disabled/degraded” states.
- Return a structured registry result that distinguishes fresh data, stale cache, and failure.
- Document telemetry behavior and ensure opt-out/disabled behavior is exercised by tests.

### 10. Rebalance test coverage toward the extension core

**Why it matters**

Current automated coverage is concentrated in pure webview logic. The most failure-prone code is in process spawning, ACP connection setup, cleanup, and VS Code-side state transitions, but those areas have little to no direct unit coverage.

**Evidence**

- Existing unit tests are almost entirely under `webview/*.test.ts`
- The only extension-side test is [src/test/extension.test.ts](/home/muhammandrafi25/Projects/vscode-acp/src/test/extension.test.ts:1), which checks activation and command registration

**What to change**

- Add unit tests for `SessionManager`, `AgentManager`, `ConnectionManager`, `FileSystemHandler`, and `TerminalHandler` with mocked VS Code and child-process boundaries.
- Add regression tests for reconnect/disconnect cycles, auth-required flows, stale session updates, and terminal cleanup.
- Track coverage by layer so the core transport/process code is not left untested while UI helpers are well covered.

## Suggested Order

1. Fix lifecycle cleanup: `SessionManager` listeners and `ConnectionManager` disposal.
2. Remove unnecessary shell execution and make file writes editor-aware.
3. Introduce typed ACP adapters and split `extension.ts`.
4. Tighten config UX/validation and state ownership between extension and webview.
5. Expand extension-core tests before adding new protocol features.

## Target Standard

If the goal is “best practice code”, the strongest next step is not cosmetic refactoring. It is making process/session lifecycle deterministic, reducing unchecked protocol handling, and building tests around those boundaries. Once those are solid, the rest of the codebase becomes much easier to evolve safely.
