# ACP Client Improvements (Based on Harnss Architecture)

After a deep architectural review of the `harnss` Electron application, several high-value features and patterns have been identified that could significantly elevate our VS Code ACP extension. 

While our extension currently implements a highly stable, protocol-compliant ACP lifecycle, Harnss excels in rich user experience, concurrent session management, and visual data representation.

## High-Priority Features

### 1. Rich Tool Visualization
* **Current State:** Our `ToolCallRow` in `MessageTimeline.tsx` renders all tool inputs and outputs uniformly using a generic accordion containing `<pre>` text blocks.
* **Improvement:** Implement specialized React components for different tool types (mirroring Harnss's `BashContent`, `EditContent`, `SearchContent`, etc.). 
* **Value:** 
  * **File Edits:** Render word-level diffs with syntax highlighting instead of dumping raw JSON patch objects.
  * **Shell Commands:** Provide stylized, terminal-like output windows.
  * **File Searches:** Present results as clickable, structured lists instead of raw grep strings.

### 2. Multi-Agent Concurrency
* **Current State:** `SessionManager` explicitly enforces a single active agent. Connecting to a new agent actively kills the previous agent's process.
* **Improvement:** Allow multiple agent processes to run concurrently and maintain their respective connections. Add a session-switcher UI in the sidebar.
* **Value:** Users could delegate a long-running background task (e.g., "Run and fix all failing tests") to one agent while simultaneously asking architectural questions to another agent without losing connection state.

### 3. Session Persistence & Resumption
* **Current State:** Chat history is largely volatile. We rely on VS Code's `setState()` to preserve the transcript while the webview is hidden, but the underlying ACP session and long-term history are lost on a window reload.
* **Improvement:** Adopt a `sessions:save` / `sessions:load` persistence layer (storing JSON transcripts to disk) and support protocol-level session resumption.
* **Value:** Users will not lose their context if VS Code restarts or if they need to pause work on a specific feature branch for several days.

### 4. Explicit MCP Server Integration
* **Current State:** We support the ACP standard, but we hardcode the `mcpServers` parameter to `[]` when calling `newSession`. There is no UI to configure MCP servers.
* **Improvement:** Build a dedicated configuration panel (or `settings.json` schema) to define project-level MCP servers (stdio/SSE/HTTP) and pass them into the agent during initialization.
* **Value:** Enables agents to seamlessly interact with external tools (Jira, Confluence, databases) using the MCP protocol natively through the client.

## Architectural & Code Style Patterns

### 1. Decomposed UI & Tool Renderers
* **Harnss Pattern:** Groups UI components by domain (e.g., `src/components/tool-renderers/`, `src/components/mcp-renderers/`).
* **Our Project:** We currently have a flat `webview/components/` structure. As we build out "Rich Tool Visualization", we should organize our components into nested domains (e.g., `webview/components/tools/BashTool.tsx`).

### 2. Decomposed State Management
* **Harnss Pattern:** Extracts monolithic React state into highly focused, composable custom hooks (e.g., `useSessionManager` is composed of `useSessionLifecycle`, `useSessionPersistence`, etc.).
* **Our Project:** As our `state.logic.ts` and `ChatComposer.logic.ts` reducers grow in complexity (especially when supporting multiple sessions), we should split the state logic into smaller, domain-specific modules.

### 3. Two-Tiered Settings
* **Harnss Pattern:** Strictly separates rapid-access UI settings (saved to localStorage) from core app settings (saved to disk).
* **Our Project:** We already leverage `vscode.workspace.getConfiguration()` for core settings. We should ensure that pure UI state (like whether a thought block is collapsed) remains isolated in webview state or `vscode.setState()` and is never synced to the user's VS Code `settings.json`.