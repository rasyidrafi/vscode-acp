import type { AvailableCommand } from '@agentclientprotocol/sdk';

import { rankText, type SearchMatchKind } from './searchRanking';

export interface RankedCommand {
  command: AvailableCommand;
  matchKind: SearchMatchKind;
  score: number;
}

export function searchCommands(
  commands: AvailableCommand[],
  query: string,
  limit = 8,
): RankedCommand[] {
  return commands
    .map((command, index) => {
      const nameRank = rankText(query, command.name);
      const descriptionRank = rankText(query, command.description);
      const bestRank = bestCommandRank(nameRank, descriptionRank);
      return bestRank
        ? {
            command,
            matchKind: bestRank.kind,
            score: bestRank.score,
            originalIndex: index,
          }
        : null;
    })
    .filter((result): result is RankedCommand & { originalIndex: number } => result !== null)
    .sort((left, right) => (
      left.score - right.score ||
      left.command.name.localeCompare(right.command.name) ||
      left.originalIndex - right.originalIndex
    ))
    .slice(0, limit)
    .map(({ originalIndex: _originalIndex, ...result }) => result);
}

function bestCommandRank(
  nameRank: ReturnType<typeof rankText>,
  descriptionRank: ReturnType<typeof rankText>,
): ReturnType<typeof rankText> {
  if (!nameRank) {
    return descriptionRank;
  }
  if (!descriptionRank) {
    return nameRank;
  }

  return nameRank.score <= descriptionRank.score + 25 ? nameRank : descriptionRank;
}
