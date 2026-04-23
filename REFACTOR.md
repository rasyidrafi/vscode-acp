# vscode-acp Refactor Plan: Complete UI Rewrite, Simplicity First

This is a **complete replacement** of the current chat webview UI. It is not a
gradual migration and it should not copy a large app architecture.

The current problem is clear: `src/ui/ChatWebviewProvider.ts` is doing too much.
It owns backend bridge work, HTML, CSS, browser JavaScript, markdown rendering,
state restore, chat rendering, input behavior, tool rendering, and session event
handling in one file. The refactor should split those responsibilities without
turning this extension into a monorepo or platform framework.

## Opinion After Reviewing `../openchamber`

I agree with using a separate React webview app and a thin VS Code provider.
I do **not** agree with copying OpenChamber's overall architecture into this
project.

OpenChamber is a larger product with web, UI, desktop, Electron, VS Code,
runtime APIs, sync providers, SSE proxying, many stores, and cross-runtime
abstractions. That makes sense for OpenChamber's scope. It is too much for
`vscode-acp`, which is a simple VS Code wrapper UI around ACP agents.

Use OpenChamber only for small implementation ideas:

- Vite-built webview assets.
- A small `webviewHtml.ts` helper instead of inline HTML inside the provider.
- VS Code theme variables for native-looking UI.
- Optional dev-server loading during extension development.

Do not copy these OpenChamber patterns:

- No monorepo.
- No shared `packages/ui`.
- No desktop, Electron, PWA, docs, or web runtime layers.
- No runtime API registry/provider system.
- No SSE proxy unless ACP itself requires it.
- No message ack/retry framework unless there is a reproduced delivery bug.
- No sync engine.
- No many-store Zustand architecture.
- No command palette, router, right sidebar, diff viewer, terminal dock, or
  project management features.

## Non-Negotiable Principles

1. **Simple wrapper UI first.** This is not a multi-billion-dollar product shell.
2. **One boundary.** Extension host owns ACP, VS Code APIs, processes, files, and
   commands. Webview owns rendering and browser interactions.
3. **No enterprise patterns by default.** Add an abstraction only when the current
   code needs it today.
4. **Complete replacement.** Build the new webview, then delete the old inline
   HTML/CSS/JS path.
5. **Small dependency surface.** Every dependency must earn its place.
6. **Maintainable by one person.** A new contributor should understand the chat
   flow in minutes, not days.

## Target Shape

Keep this repository as a single VS Code extension package:

```text
src/
  extension.ts
  core/
  handlers/
  ui/
    ChatWebviewProvider.ts
    webviewHtml.ts
  shared/
    bridge.ts
webview/
  index.html
  main.tsx
  App.tsx
  bridge.ts
  state.ts
  components/
    ChatView.tsx
    MessageList.tsx
    MessageItem.tsx
    ToolCall.tsx
    PlanBlock.tsx
    ChatInput.tsx
    SessionBanner.tsx
  styles.css
```

This is intentionally boring. No `packages/`, no nested app framework, no
cross-runtime layer.

## Backend Responsibilities

`ChatWebviewProvider` should become a small adapter:

- Create the webview.
- Serve the HTML shell from `webviewHtml.ts`.
- Receive typed messages from the webview.
- Call `SessionManager` methods.
- Forward `SessionUpdateHandler` notifications to the webview.
- Push active session, mode, model, and command state to the webview.

It should not:

- Render markdown.
- Build message DOM.
- Store browser UI state.
- Contain CSS.
- Contain long inline scripts.
- Know how tool cards visually look.

Target size: keep `ChatWebviewProvider.ts` roughly under 250 lines. If it grows
past that, move logic to a small helper instead of rebuilding a giant provider.

## Frontend Responsibilities

The React webview should own:

- Message list rendering.
- Markdown rendering.
- Tool call and plan rendering.
- Input, send, cancel, slash command suggestions, mode/model controls.
- Chat history restore with `vscode.getState()` / `vscode.setState()`.
- Scroll behavior.
- Empty, connected, sending, cancelled, and error states.

Use React state or a single `useReducer` first. Do not add Zustand unless the
state becomes genuinely painful after the first implementation. A simple reducer
is easier to debug and is enough for this UI.

## Bridge Contract

Keep the bridge explicit and small. A typed union is enough.

Webview to extension:

- `ready`
- `sendPrompt`
- `cancelTurn`
- `setMode`
- `setModel`
- `executeCommand`

Extension to webview:

- `state`
- `sessionUpdate`
- `promptStart`
- `promptEnd`
- `error`
- `clearChat`
- `modesUpdate`
- `modelsUpdate`

No generic RPC framework. No pending request map unless a real request/response
operation needs it. Most messages are commands or events, so direct message
passing is simpler.

## Data Model

Add a tiny frontend model that is independent from DOM details:

```ts
type ChatItem =
  | { kind: 'message'; role: 'user' | 'assistant' | 'system'; text: string }
  | { kind: 'toolCall'; id: string; title: string; status: 'pending' | 'running' | 'completed' | 'failed' }
  | { kind: 'plan'; entries: Array<{ text: string; completed?: boolean }> }
  | { kind: 'error'; text: string };
```

The reducer should translate ACP session updates into this model. Components
render the model. This missing layer is important because the current webview
mixes protocol handling, history state, and DOM mutation in one script.

## Tooling

Use:

- `esbuild` for the extension backend bundle.
- `vite` for the webview app.
- `typescript`.
- `react` and `react-dom`.
- `react-markdown` plus `remark-gfm`.
- Plain CSS using VS Code theme variables.
- Optional `lucide-react` only if icons are needed and VS Code codicons are not
  enough.

Avoid for now:

- Tailwind, unless the implementation proves plain CSS is becoming harder.
- Radix, unless a specific accessible popover/select/dialog is needed.
- Shiki, unless syntax highlighting is a must-have for the first pass.
- Zustand, unless `useReducer` becomes too awkward.
- Any UI kit.

This keeps setup fast and prevents dependency sprawl.

## UI Scope

Build a polished but small chat UI:

- Native VS Code colors and typography.
- Connected session banner with agent name and cwd.
- User and assistant messages.
- Markdown for assistant output.
- Compact tool call rows with status.
- Plan block rendering.
- Input box with send/cancel.
- Slash command suggestions from ACP `available_commands_update`.
- Mode and model selectors when the active session exposes them.
- Clear empty state with connect/new conversation actions.
- Error display that does not break the chat.

Do not build:

- Multiple app views.
- File explorer.
- Terminal.
- Git panel.
- Diff viewer.
- Settings UI beyond existing VS Code settings/commands.
- Voice, TTS, onboarding, project manager, command palette, or tabs.

## Implementation Phases

### Phase 1: Tooling and Shell

- Add Vite webview app under `webview/`.
- Add `src/ui/webviewHtml.ts`.
- Add minimal CSP that supports production assets and optional dev server.
- Add esbuild config/script for the extension bundle.
- Keep the repository as one package.
- Confirm extension activation still works.

### Phase 2: Bridge and State

- Add `src/shared/bridge.ts` with message types.
- Add `webview/bridge.ts` wrapper around `acquireVsCodeApi()`.
- Add `webview/state.ts` reducer for chat/session state.
- Move markdown rendering to React.
- Preserve `vscode.getState()` / `vscode.setState()` restore behavior.

### Phase 3: UI Replacement

- Build the React chat components.
- Recreate current behavior from `ChatWebviewProvider.ts`.
- Handle current ACP update types:
  - assistant text/content updates
  - thought/reasoning text if present
  - tool call create/update
  - plan updates
  - available command updates
- Keep rendering compact and readable in a VS Code sidebar.

### Phase 4: Delete Legacy UI

- Remove inline HTML/CSS/JS from `ChatWebviewProvider.ts`.
- Remove backend markdown rendering and the `marked` dependency if nothing else
  uses it.
- Remove obsolete message types such as `renderMarkdown`.
- Keep provider code as bridge wiring only.

### Phase 5: Verification

- Build extension bundle.
- Build webview bundle.
- Run type-check.
- Run lint.
- Manually test:
  - connect agent
  - send prompt
  - streaming assistant output
  - tool call status updates
  - plan rendering
  - slash commands
  - cancel turn
  - new conversation clears UI
  - switching agents updates state
  - webview hide/show restores chat

## Missing From The Old Plan

The previous plan was directionally good, but it missed several guardrails:

- It did not explicitly reject OpenChamber's larger app architecture.
- It added Zustand, Tailwind, Shiki, and Radix too early.
- It did not define a small frontend data model.
- It did not say which current behaviors must be preserved.
- It did not set size/scope limits for the provider.
- It did not define what to delete after replacement.
- It did not separate useful OpenChamber ideas from OpenChamber-specific
  complexity.
- It did not include a manual verification checklist for the existing chat
  workflow.

## Definition of Done

- `ChatWebviewProvider.ts` is a thin bridge/provider, not a UI file.
- The old inline webview implementation is gone.
- The React webview fully replaces current chat behavior.
- The extension still feels native inside VS Code.
- The build flow is simple and documented in `package.json` scripts.
- The UI is good enough to use daily without importing a large app framework.
- The codebase is easier to understand and maintain than before the refactor.

If a proposed change makes the project look like OpenChamber's full
multi-runtime architecture, reject it unless there is a concrete bug or feature
in `vscode-acp` that cannot be solved more directly.
