# OACP

Open ACP client VS Code extension. OACP is a [Visual Studio Code extension](https://marketplace.visualstudio.com/items?itemName=rasyidrafi.oacp) that provides a client for the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) — connect to any ACP-compatible AI coding agent directly from your editor.

![OACP Screenshot](resources/screenshot.png)

## Features

- **Multi-Agent Support**: Connect to 11 pre-configured ACP agents or add your own
- **Single-Agent Focus**: One agent active at a time — seamlessly switch between agents
- **Interactive Chat**: Built-in chat panel with Markdown rendering, inline tool call display, and collapsible tool sections
- **Thinking Display**: See agent reasoning in a collapsible block with streaming animation and elapsed time
- **Slash Commands**: Autocomplete popup for agent-provided commands with keyboard navigation
- **Mode & Model Picker**: Switch agent modes and models directly from the chat toolbar
- **File System Integration**: Agents can read and write files in your workspace
- **Terminal Execution**: Agents can run commands with terminal output display
- **Permission Management**: Configurable auto-approve policies for agent actions
- **Protocol Traffic Logging**: Inspect all ACP JSON-RPC messages with request/response/notification labels
- **Agent Registry**: Browse and discover available ACP agents
- **Chat Persistence**: Conversations are preserved when switching panels

## Quick Start

1. Install: [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=rasyidrafi.oacp) | [Open in VS Code](https://vscode.dev/redirect?url=vscode%3Aextension%2Frasyidrafi.oacp) | [Open VSX Marketplace](https://open-vsx.org/extension/rasyidrafi/oacp)
2. Open the OACP panel from the Activity Bar (OACP icon)
3. Click **+** to add an agent configuration, or use the defaults
4. Click an agent to connect
5. Start chatting!

## Requirements

- Node.js 18+ (for spawning agent processes)
- An ACP-compatible agent installed or available via `npx`

## Pre-configured Agents

The extension comes with default configurations for:

| Agent | Command |
|-------|---------|
| GitHub Copilot | `npx @github/copilot-language-server@latest --acp` |
| Claude Code | `npx @zed-industries/claude-code-acp@latest` |
| Gemini CLI | `gemini --acp` if found on `PATH`, otherwise `npx @google/gemini-cli@latest --acp` |
| Qwen Code | `npx @qwen-code/qwen-code@latest --acp --experimental-skills` |
| Auggie CLI | `npx @augmentcode/auggie@latest --acp` |
| Qoder CLI | `npx @qoder-ai/qodercli@latest --acp` |
| Codex CLI | `npx @zed-industries/codex-acp@latest` |
| OpenCode | `npx opencode-ai@latest acp` |
| OpenClaw | `npx openclaw acp` |
| [Kiro CLI](https://kiro.dev/docs/cli/acp/) | `kiro-cli acp` |
| [Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp) | `hermes acp` |

You can add custom agent configurations in settings.

For each agent entry, launch resolution is:

1. `binaryPath` when explicitly set
2. `binaryName` resolved from `PATH`
3. `command` plus `args` as fallback

This is useful for CLIs like Gemini that may already be installed locally, while still preserving `npx` fallback for ACP packages that do not expose a stable local binary.

> **Note on Hermes Agent**: Hermes is a Python package, not an npm package. Install it via the [Hermes Quickstart](https://hermes-agent.nousresearch.com/docs/getting-started/quickstart) (Linux/macOS/WSL2 only — Windows requires [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install)). Make sure `hermes` is on your `PATH` and launch VS Code from the same shell/venv. Configure credentials with `hermes model`.

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `acp.agents` | *(11 agents)* | Agent configurations. Each key is the agent name, with optional `binaryPath`, `binaryName`, `binaryArgs`, plus fallback `command`, `args`, and `env`. |
| `acp.autoApprovePermissions` | `ask` | How agent permission requests are handled: `ask` or `allowAll`. |
| `acp.defaultWorkingDirectory` | `""` | Default working directory for agent sessions. Empty uses current workspace. |
| `acp.logTraffic` | `true` | Log all ACP protocol traffic to the OACP Traffic output channel. |

## Commands

All commands are accessible via the Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `OACP: Connect to Agent` | Connect to an agent |
| `OACP: New Conversation` | Start a new conversation with the connected agent |
| `OACP: Send Prompt` | Send a message to the agent |
| `OACP: Cancel Current Turn` | Cancel the current agent turn |
| `OACP: Disconnect Agent` | Disconnect from the current agent |
| `OACP: Restart Agent` | Restart the current agent process |
| `OACP: Open Chat Panel` | Focus the chat webview |
| `OACP: Add Agent Configuration` | Add a new agent to settings |
| `OACP: Remove Agent` | Remove an agent configuration |
| `OACP: Set Agent Mode` | Change the agent's operating mode |
| `OACP: Set Agent Model` | Change the agent's model |
| `OACP: Show Log` | Open the OACP log output channel |
| `OACP: Show Protocol Traffic` | Open the OACP Traffic output channel |
| `OACP: Browse Agent Registry` | Browse the ACP agent registry |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` (`Cmd+Shift+A` on Mac) | Open Chat Panel |
| `Escape` (when turn in progress) | Cancel Current Turn |

## Development

### Prerequisites

- Node.js 18+
- VS Code 1.85+

### Setup

```bash
git clone https://github.com/rasyidrafi/vscode-oacp.git
cd vscode-oacp
npm install
```

### Build & Run

```bash
npm run compile    # One-time build
npm run watch      # Watch mode for development
```

Press `F5` in VS Code to launch the Extension Development Host.

### Testing

```bash
npm run pretest    # Compile tests + lint
npm test           # Run tests
```

### Packaging

```bash
npm run package    # Production build
npx @vscode/vsce package   # Create .vsix
```

## Architecture

The extension follows a modular architecture:

- **Core**: `AgentManager`, `ConnectionManager`, `SessionManager`, `AcpClientImpl`
- **Handlers**: `FileSystemHandler`, `TerminalHandler`, `PermissionHandler`, `SessionUpdateHandler`
- **UI**: `SessionTreeProvider`, `ChatWebviewProvider`, `StatusBarManager`
- **Config**: `AgentConfig`, `RegistryClient`
- **Utils**: `Logger`, `StreamAdapter`

Communication with agents uses the ACP protocol (JSON-RPC 2.0 over stdio).

## Known Issues

- Agents must be available via the system PATH or `npx`
- Some agents may require additional authentication setup
- File attachment feature is not yet functional

## Links

- [OACP on Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=rasyidrafi.oacp)
- [Agent Client Protocol](https://agentclientprotocol.com/)
- [GitHub Repository](https://github.com/rasyidrafi/vscode-oacp)

## License

Forked from [formulahendry/vscode-acp](https://github.com/formulahendry/vscode-acp).

MIT — see [LICENSE](LICENSE) for details.
