import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { log, logError } from '../utils/Logger';
import { sendEvent, sendError } from '../utils/TelemetryManager';
import type { AgentConfigEntry } from '../config/AgentConfig';

/**
 * Escape a single argument for safe inclusion in a shell command string.
 * Wraps in single quotes, escaping any embedded single quotes.
 */
function shellEscape(arg: string): string {
  // Replace ' with '\'' (end quote, escaped quote, start quote)
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Determine the appropriate shell and whether it supports the -l (login) flag
 * on macOS/Linux. A login shell sources the user's profile (~/.zshrc,
 * ~/.bash_profile, etc.) so that PATH includes nvm, Homebrew, and other
 * user-installed tool directories.
 *
 * Shell support:
 *   zsh, bash, ksh  →  -l supported
 *   fish, sh, dash  →  use as-is without -l (fish auto-loads config;
 *                      sh/dash don't support -l reliably)
 *   csh, tcsh, etc. →  not POSIX-compatible; fall back to bash or /bin/sh
 */
function resolveUnixShell(): { shell: string; useLoginFlag: boolean } {
  const userShell = process.env.SHELL;

  if (userShell) {
    const base = userShell.split('/').pop() || '';

    // POSIX-compatible shells that support -l (login) flag
    if (['zsh', 'bash', 'ksh'].includes(base)) {
      return { shell: userShell, useLoginFlag: true };
    }

    // fish auto-loads config without -l; sh/dash are POSIX-compatible but
    // don't support -l reliably
    if (['fish', 'sh', 'dash'].includes(base)) {
      return { shell: userShell, useLoginFlag: false };
    }

    // Non-POSIX shells (csh, tcsh, etc.) — fall back to a known POSIX shell
    log(`User shell "${userShell}" is not POSIX-compatible, falling back to bash/sh`);
  }

  // $SHELL not set or not POSIX-compatible — probe for common shells
  if (existsSync('/bin/bash')) {
    return { shell: '/bin/bash', useLoginFlag: true };
  }
  if (existsSync('/usr/bin/bash')) {
    return { shell: '/usr/bin/bash', useLoginFlag: true };
  }
  // Ultimate fallback
  return { shell: '/bin/sh', useLoginFlag: false };
}

export interface AgentInstance {
  id: string;
  name: string;
  process: ChildProcess;
  config: AgentConfigEntry;
}

interface ResolvedLaunchConfig {
  command: string;
  args: string[];
  source: 'binaryPath' | 'binaryName' | 'fallback';
}

/**
 * Manages spawning and killing ACP agent child processes.
 */
export class AgentManager extends EventEmitter {
  private agents: Map<string, AgentInstance> = new Map();
  private nextId = 1;

  private resolveBinaryFromPath(binaryName: string): string | undefined {
    const pathValue = process.env.PATH;
    if (!pathValue) {
      return undefined;
    }

    const pathEntries = pathValue.split(delimiter).filter(Boolean);
    const candidateNames = process.platform === 'win32'
      ? this.getWindowsCandidateNames(binaryName)
      : [binaryName];

    for (const entry of pathEntries) {
      for (const candidateName of candidateNames) {
        const candidatePath = join(entry, candidateName);
        if (existsSync(candidatePath)) {
          return candidatePath;
        }
      }
    }

    return undefined;
  }

  private getWindowsCandidateNames(binaryName: string): string[] {
    const extensions = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .filter(Boolean);

    const hasExtension = /\.[^\\/]+$/.test(binaryName);
    if (hasExtension) {
      return [binaryName];
    }

    return [binaryName, ...extensions.map(ext => `${binaryName}${ext.toLowerCase()}`)];
  }

  private resolveLaunchConfig(config: AgentConfigEntry): ResolvedLaunchConfig {
    const binaryPath = config.binaryPath?.trim();
    if (binaryPath) {
      return {
        command: binaryPath,
        args: config.binaryArgs || [],
        source: 'binaryPath',
      };
    }

    const binaryName = config.binaryName?.trim();
    if (binaryName) {
      const resolvedBinaryPath = this.resolveBinaryFromPath(binaryName);
      if (resolvedBinaryPath) {
        return {
          command: resolvedBinaryPath,
          args: config.binaryArgs || [],
          source: 'binaryName',
        };
      }
    }

    return {
      command: config.command,
      args: config.args || [],
      source: 'fallback',
    };
  }

  /**
   * Spawn an agent as a child process with stdin/stdout piped.
   */
  spawnAgent(name: string, config: AgentConfigEntry, cwd?: string): AgentInstance {
    const id = `agent_${this.nextId++}`;
    const launchConfig = this.resolveLaunchConfig(config);
    log(`Spawning agent "${name}" (${id}) via ${launchConfig.source}: ${launchConfig.command} ${launchConfig.args.join(' ')}`);

    const child = (() => {
      if (process.platform === 'win32') {
        // On Windows, commands like npx are batch scripts (.cmd) that require
        // shell resolution via cmd.exe.
        return spawn(launchConfig.command, launchConfig.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ...(config.env || {}) },
          cwd: cwd || undefined,
          shell: true,
        });
      }

      // On macOS/Linux, use the user's login shell so that PATH includes
      // nvm, Homebrew, and other user-installed tool directories.
      const { shell, useLoginFlag } = resolveUnixShell();
      const commandStr = [launchConfig.command, ...launchConfig.args].map(shellEscape).join(' ');
      const shellArgs = useLoginFlag ? ['-l', '-c', commandStr] : ['-c', commandStr];

      log(`Using shell: ${shell} ${shellArgs.join(' ')}`);
      const shellName = shell.split('/').pop() || shell;
      sendEvent('agent/spawn/shell', {
        shell: shellName,
        useLoginFlag: String(useLoginFlag),
        launchSource: launchConfig.source,
        commandBase: dirname(launchConfig.command) === '.'
          ? launchConfig.command
          : basename(launchConfig.command),
      });
      return spawn(shell, shellArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...(config.env || {}) },
        cwd: cwd || undefined,
      });
    })();

    const instance: AgentInstance = { id, name, process: child, config };
    this.agents.set(id, instance);

    // Forward stderr for debugging
    child.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        log(`[${name} stderr] ${line}`);
        this.emit('agent-stderr', { agentId: id, line });
      }
    });

    child.on('error', (err) => {
      logError(`Agent "${name}" process error`, err);
      sendError('agent/error', { agentName: name, errorType: err.message });
      this.emit('agent-error', { agentId: id, error: err });
    });

    child.on('close', (code, signal) => {
      log(`Agent "${name}" exited (code=${code}, signal=${signal})`);
      this.agents.delete(id);
      this.emit('agent-closed', { agentId: id, code, signal });
    });

    return instance;
  }

  /**
   * Kill an agent process.
   */
  killAgent(agentId: string): boolean {
    const instance = this.agents.get(agentId);
    if (!instance) {
      return false;
    }

    log(`Killing agent "${instance.name}" (${agentId})`);

    try {
      instance.process.kill('SIGTERM');
      // Force kill after 5s if still running
      setTimeout(() => {
        if (instance.process.exitCode === null) {
          instance.process.kill('SIGKILL');
        }
      }, 5000);
    } catch (e) {
      logError(`Failed to kill agent ${agentId}`, e);
    }

    this.agents.delete(agentId);
    return true;
  }

  /**
   * Get a running agent by ID.
   */
  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all running agents.
   */
  getRunningAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /**
   * Kill all running agents. Called on extension deactivate.
   */
  killAll(): void {
    for (const [id] of this.agents) {
      this.killAgent(id);
    }
  }

  dispose(): void {
    this.killAll();
    this.removeAllListeners();
  }
}
