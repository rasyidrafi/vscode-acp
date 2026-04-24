import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { delimiter, isAbsolute, join } from 'node:path';
import { existsSync } from 'node:fs';

export function getWindowsCandidateNames(command: string, pathext = process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM'): string[] {
  const extensions = pathext
    .split(';')
    .filter(Boolean);

  const hasExtension = /\.[^\\/]+$/.test(command);
  if (hasExtension) {
    return [command];
  }

  return [command, ...extensions.map(ext => `${command}${ext.toLowerCase()}`)];
}

export function resolveCommandFromPath(
  command: string,
  platform = process.platform,
  pathValue = process.env.PATH,
): string | undefined {
  if (!command || command.includes('/') || command.includes('\\') || isAbsolute(command)) {
    return undefined;
  }

  if (!pathValue) {
    return undefined;
  }

  const pathEntries = pathValue.split(delimiter).filter(Boolean);
  const candidateNames = platform === 'win32'
    ? getWindowsCandidateNames(command)
    : [command];

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

export function shouldUseShellForCommand(command: string, platform = process.platform): boolean {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

export function spawnCommand(
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcess {
  return spawn(command, args, {
    ...options,
    shell: shouldUseShellForCommand(command),
  });
}
