# vscode-acp Refactor Plan: Borrowed T3Code Code Patterns

This plan is based on reviewing this repository and `../t3code`.

The goal is not to clone T3Code. T3Code is a web/desktop app with a server,
shared packages, Effect services, orchestration, persistence, git flows,
terminals, and broad product UI. `vscode-acp` is a VS Code extension, so the
architecture must stay extension-native.

The goal is to borrow selected coding patterns from T3Code where they make this
extension easier to maintain:

- typed boundaries
- explicit data models
- small files with clear ownership
- logic extracted beside components
- focused tests for logic
- compact, native-feeling UI
- deterministic event handling
- simple, enforceable quality gates

## Current Problem

`src/ui/ChatWebviewProvider.ts` is doing too much. It owns extension bridge
logic, HTML, CSS, browser JavaScript, markdown rendering, DOM mutation, state
restore, chat rendering, input behavior, tool rendering, plan rendering, and
session event handling.

That shape makes every UI change risky because protocol handling, state
normalization, and rendering are mixed together in one file.

The refactor should be a complete replacement of the inline webview UI, not a
gradual decoration of the current file.

## Opinion After Reviewing `../t3code`

Borrow these T3Code code patterns:

- **Contracts at boundaries.** T3Code keeps transport methods and payload shapes
  explicit. Do the same with a small `src/shared/bridge.ts` union for
  extension-to-webview and webview-to-extension messages.
- **Normalize events before rendering.** T3Code does not render raw provider
  events directly. `vscode-acp` should translate ACP notifications into a small
  chat timeline model, then render that model.
- **Use `.logic.ts` files for testable behavior.** T3Code keeps search,
  timeline derivation, send-state derivation, and layout decisions in plain TS
  files with tests. Do this for slash command search, timeline row derivation,
  and ACP update normalization.
- **Keep components focused.** Components should receive already-shaped data and
  callbacks. They should not parse ACP payloads or know about VS Code message
  transport internals.
- **Use stable derived rows for streaming.** T3Code avoids unnecessary row
  churn in streaming timelines. `vscode-acp` should preserve existing row
  object identity when session updates do not change visible row fields.
- **Use ranked command search.** T3Code's command search is small and practical:
  exact, prefix, boundary, includes, then fuzzy. Use the same idea for ACP slash
  commands.
- **Use explicit UI primitives.** Build local `Button`, `IconButton`, `Select`,
  `Tooltip`, and `Spinner` components instead of scattering raw markup and
  class names everywhere.
- **Use tests as design pressure.** The most important behavior should be
  testable without VS Code: bridge type guards, reducer transitions, timeline
  derivation, command search, and markdown link handling.

Do not copy these T3Code product/architecture patterns:

- No monorepo.
- No `apps/*` and `packages/*`.
- No Bun requirement.
- No server process.
- No WebSocket or RPC framework.
- No Effect service graph.
- No database, event store, orchestration engine, checkpointing, git manager, or
  terminal system.
- No broad app shell with router, settings pages, sidebars, right panels, or
  command palette.
- No shared UI package.
- No Tailwind/Base UI/Radix stack unless a specific control proves too hard with
  simple React and CSS.

## Non-Negotiable Principles

1. **Keep it a VS Code extension.** The extension host owns ACP, VS Code APIs,
   processes, files, commands, telemetry, and permission prompts.
2. **The webview owns UI only.** It renders chat, manages browser interaction,
   restores browser state, and posts typed commands back to the extension.
3. **Typed boundary, not generic RPC.** VS Code webview messaging is enough.
   Use discriminated unions and small runtime guards.
4. **Normalize once.** Raw ACP updates should enter one reducer/normalizer path,
   not leak into multiple components.
5. **Small dependency surface.** Add dependencies only when they remove real
   complexity from this extension.
6. **Daily-use UI.** The UI should be compact, polished, keyboard-friendly, and
   native inside a VS Code sidebar.
7. **Easy to maintain.** A new contributor should understand the chat flow from
   provider to component in minutes.

## Target Repository Shape

Keep this repository as one package:

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
    chatModel.ts
    acpUpdateModel.ts
webview/
  index.html
  main.tsx
  App.tsx
  bridge.ts
  state.ts
  state.logic.ts
  state.logic.test.ts
  components/
    ChatView.tsx
    MessageTimeline.tsx
    MessageTimeline.logic.ts
    MessageTimeline.logic.test.ts
    MessageRow.tsx
    ToolCallRow.tsx
    PlanBlock.tsx
    ChatComposer.tsx
    ComposerCommandMenu.tsx
    SessionBanner.tsx
    EmptyState.tsx
    ErrorBanner.tsx
    ui/
      Button.tsx
      IconButton.tsx
      Select.tsx
      Spinner.tsx
      Tooltip.tsx
  lib/
    cn.ts
    searchRanking.ts
    commandSearch.ts
    commandSearch.test.ts
    markdownLinks.ts
    markdownLinks.test.ts
  styles.css
```

This uses the same kind of code organization discipline as T3Code, but at VS
Code extension scale:

- `*.logic.ts` files hold pure logic.
- Components are mostly rendering and event wiring.
- Shared contracts live near the boundary.
- There is no barrel-export-heavy package structure.

## Backend Responsibilities

`ChatWebviewProvider.ts` should become a small adapter:

- create and configure the `WebviewView`
- serve HTML from `webviewHtml.ts`
- receive typed webview messages
- validate message shape before acting
- call `SessionManager`
- forward active-session updates to the webview
- send active session metadata, modes, models, and available commands
- expose small public methods used by `extension.ts`

It should not:

- render markdown
- build message DOM
- store browser-only UI state
- contain CSS
- contain long inline scripts
- know how tool calls, plans, or thoughts visually look
- parse ACP updates beyond active-session filtering and minimal persistence of
  available commands


## Frontend Responsibilities

The React webview should own:

- message timeline rendering
- markdown rendering
- tool call rendering
- plan rendering
- thought/reasoning rendering
- input, send, cancel, and keyboard behavior
- slash command suggestions
- mode/model controls
- empty, connected, sending, cancelled, and error states
- `vscode.getState()` and `vscode.setState()` restore
- scroll-to-bottom behavior during streaming

Use React state plus `useReducer` first. T3Code uses more infrastructure because
its app surface is larger. This extension should start with one reducer and
split only when the reducer becomes hard to reason about.

## Bridge Contract

Add `src/shared/bridge.ts` with typed discriminated unions.

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
- `modesUpdate`
- `modelsUpdate`

Also add small runtime guards:

- reject unknown message types
- reject missing required fields
- keep command execution allowlisted to known extension commands where possible

Do not add a pending request map or RPC abstraction until there is a real
request/response flow that needs it.

## Data Model

Add a frontend-oriented model independent from DOM details:

```ts
export type ChatItem =
  | {
      kind: 'message';
      id: string;
      role: 'user' | 'assistant' | 'system';
      text: string;
      streaming?: boolean;
    }
  | {
      kind: 'thought';
      id: string;
      text: string;
      streaming?: boolean;
      collapsed?: boolean;
    }
  | {
      kind: 'toolCall';
      id: string;
      title: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      detail?: string;
    }
  | {
      kind: 'plan';
      id: string;
      entries: Array<{ id: string; text: string; completed?: boolean }>;
    }
  | {
      kind: 'error';
      id: string;
      text: string;
    };
```

Then derive render rows:

```ts
export type TimelineRow =
  | { kind: 'message'; id: string; item: Extract<ChatItem, { kind: 'message' }> }
  | { kind: 'work'; id: string; items: Array<Extract<ChatItem, { kind: 'toolCall' | 'thought' }> }
  | { kind: 'plan'; id: string; item: Extract<ChatItem, { kind: 'plan' }> }
  | { kind: 'error'; id: string; item: Extract<ChatItem, { kind: 'error' }> }
  | { kind: 'working'; id: string };
```

This borrows T3Code's event-to-model-to-rendering pattern: normalize protocol
events into domain items, derive timeline rows, then render rows. Components
should not inspect raw ACP payload shapes.

## UI Standard

The UI should feel like a first-class VS Code sidebar:

- use VS Code theme variables for color, typography, borders, focus, and error
  states
- keep the layout dense and readable
- avoid large cards and nested cards
- use 4-8px radii
- keep icon buttons square with tooltips
- use native `select` where it is good enough
- use compact status rows for tool calls
- show assistant messages as markdown blocks without oversized bubbles
- show user prompts as compact right-aligned blocks
- keep the composer pinned at the bottom
- preserve text wrapping and avoid horizontal overflow
- use visible focus states for keyboard users
- use lucide-react for a consistent, tree-shakable icon set

Controls to build:

- session banner with agent, cwd, and connection state
- mode selector
- model selector
- slash command menu with ranked search
- send/cancel icon button
- clear/retry/error controls where useful
- compact loading/streaming indicator

Do not build:

- landing page
- file explorer
- terminal dock
- git panel
- diff viewer
- settings page
- router
- right sidebar
- project manager
- global command palette
- onboarding flow

## Tooling Standard

Current repo uses webpack, ESLint, TypeScript, and `vscode-test`.

Refactor target:

- `esbuild` for the extension backend bundle, or keep webpack only if switching
  creates more churn than value
- `vite` for the webview app
- `typescript`
- `react` and `react-dom`
- `react-markdown` and `remark-gfm`
- plain CSS with VS Code variables
- `vitest` for pure webview logic tests

T3Code uses `oxlint` and `oxfmt`. Those tools may be useful once the React
webview is introduced, but they should be adopted deliberately:

- add `oxlint` if ESLint becomes slow or noisy for the mixed extension/webview
  codebase
- add `oxfmt` only if the team wants one formatter for TS, TSX, JSON, and CSS
- keep `npm` scripts; do not require Bun for this extension

Recommended scripts:

- `compile` builds extension and webview in development mode
- `watch` watches extension and webview
- `package` builds production extension and production webview
- `typecheck` runs TypeScript checks for extension and webview
- `lint` runs ESLint or oxlint
- `test:unit` runs Vitest logic tests
- `test` runs extension tests

## Implementation Phases

### Phase 1: Contracts and Build Shell

- Add `src/shared/bridge.ts`.
- Add `src/shared/chatModel.ts`.
- Add `src/ui/webviewHtml.ts`.
- Add Vite webview app under `webview/`.
- Configure production asset loading with a strict CSP.
- Support optional local Vite dev-server loading only during extension
  development.
- Keep old `ChatWebviewProvider.ts` working until the React shell can load.

### Phase 2: Thin Provider

- Move HTML generation out of `ChatWebviewProvider.ts`.
- Replace inline markdown rendering with webview-side markdown rendering.
- Remove `renderMarkdown` and `markdownRendered` bridge messages.
- Add runtime validation for webview messages.
- Keep `ChatWebviewProvider.ts` as bridge wiring and command dispatch.
- Preserve telemetry for `chat/messageSent`.

### Phase 3: Reducer and Normalization

- Add `webview/state.ts` and `webview/state.logic.ts`.
- Translate ACP session updates into `ChatItem` values.
- Preserve current update support:
  - assistant text/content updates
  - thought/reasoning text
  - tool call create/update
  - plan updates
  - available command updates
  - prompt start/end
  - error events
- Persist enough webview state with `vscode.setState()` to survive hide/show.
- Add unit tests for reducer transitions and restore behavior.

### Phase 4: Timeline and Streaming UI

- Add `MessageTimeline.tsx` and `MessageTimeline.logic.ts`.
- Group adjacent work items into compact work rows.
- Preserve stable row identity across streaming updates where fields did not
  change.
- Auto-scroll only when the user is already at the bottom.
- Add copy button for completed assistant messages if it stays simple.
- Add tests for row derivation and stable rows.

### Phase 5: Composer and Commands

- Add `ChatComposer.tsx`.
- Add `ComposerCommandMenu.tsx`.
- Implement ranked slash-command search based on T3Code's search style:
  exact, prefix, boundary, includes, fuzzy, deterministic tie-breaker.
- Support keyboard navigation in the command menu.
- Support enter-to-send and shift-enter newline.
- Show cancel while a turn is active.
- Add tests for send state and command search.

### Phase 6: Mode, Model, and Session Controls

- Add `SessionBanner.tsx`.
- Add mode and model selectors.
- Keep selectors compact and hidden when unavailable.
- Show active agent name and cwd.
- Update state on active session switch.
- Ensure new conversation clears the visible timeline.

### Phase 7: Delete Legacy UI

- Delete inline HTML, CSS, and browser JavaScript from
  `ChatWebviewProvider.ts`.
- Remove backend markdown rendering.
- Remove `marked` if nothing else uses it.
- Remove obsolete bridge messages.
- Keep only the React webview path.

### Phase 8: Quality Gates

- Add unit tests for:
  - bridge guards
  - reducer transitions
  - ACP update normalization
  - timeline row derivation
  - slash command search
  - markdown link safety
- Build extension bundle.
- Build webview bundle.
- Run typecheck.
- Run lint.
- Run extension tests.

### Phase 9: Manual Verification

Manually test:

- connect agent
- disconnect agent
- restart agent
- send prompt
- streaming assistant output
- thought/reasoning display
- tool call status updates
- plan rendering
- slash commands
- mode change
- model change
- cancel turn
- new conversation clears UI
- switching agents updates state
- webview hide/show restores chat
- errors display without breaking input
- small sidebar width does not overflow
- light and dark VS Code themes

## Migration Guardrails

- Do not introduce app-wide architecture before the UI replacement works.
- Do not copy T3Code's server/runtime/orchestration layers.
- Do not add state libraries until the reducer becomes painful.
- Do not add Tailwind or a UI kit for the first pass.
- Do not add syntax highlighting unless plain code blocks are clearly
  insufficient.
- Do not build non-chat product features during this refactor.
- Do not keep old inline UI code after the React replacement is complete.

## Definition of Done

- `ChatWebviewProvider.ts` is a thin VS Code bridge/provider.
- The old inline webview implementation is gone.
- Bridge message types are explicit and validated at runtime.
- ACP updates flow through one normalization/reducer path.
- React components render typed timeline rows, not raw protocol payloads.
- Slash command search is ranked, deterministic, and tested.
- Core UI logic has focused unit tests.
- The chat UI is compact, native-looking, and usable in a VS Code sidebar.
- The build and test scripts are documented in `package.json`.
- The codebase is easier to understand and maintain than before the refactor.

If a proposed change makes this repository look like T3Code's full app/server
architecture, reject it unless there is a concrete `vscode-acp` bug or feature
that cannot be solved with a smaller extension-native design.
