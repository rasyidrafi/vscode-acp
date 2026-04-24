import type { ActivityItem, ConversationMessage, TimelineRow } from '../../src/shared/chatModel';

export interface DeriveTimelineRowsOptions {
  previousRows?: TimelineRow[];
  turnInProgress?: boolean;
}

type WorkItem = Extract<ActivityItem, { kind: 'toolCall' | 'thought' }>;
export function deriveTimelineRows(
  messages: ConversationMessage[],
  activities: ActivityItem[],
  options: DeriveTimelineRowsOptions = {},
): TimelineRow[] {
  const nextRows = buildRows(messages, activities, Boolean(options.turnInProgress));
  if (!options.previousRows || options.previousRows.length === 0) {
    return nextRows;
  }

  const previousById = new Map(options.previousRows.map((row) => [row.id, row]));
  return nextRows.map((row) => reuseStableRow(previousById.get(row.id), row));
}

function buildRows(
  messages: ConversationMessage[],
  activities: ActivityItem[],
  turnInProgress: boolean,
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const mergedItems = [...messages, ...activities].sort((left, right) => left.order - right.order);
  const lastAssistantId = [...messages].reverse().find((item) => item.role === 'assistant')?.id ?? null;
  const lastItemId = mergedItems[mergedItems.length - 1]?.id ?? null;
  let awaitingResponseStart = false;

  for (const item of mergedItems) {
    switch (item.kind) {
      case 'message':
        if (item.role === 'user') {
          rows.push({
            kind: 'message',
            id: item.id,
            item,
          });
          awaitingResponseStart = true;
          break;
        }

        const currentIndex = mergedItems.indexOf(item);
        const nextItem = mergedItems[currentIndex + 1];
        const isFollowedByAssistantItem = nextItem && (nextItem.kind !== 'message' || nextItem.role === 'assistant');

        rows.push({
          kind: 'message',
          id: item.id,
          item,
          showResponseDivider: awaitingResponseStart,
          showAssistantMeta: item.role === 'assistant' && !isFollowedByAssistantItem,
        });
        awaitingResponseStart = false;
        break;
      case 'thought':
        rows.push({
          kind: 'thought',
          id: item.id,
          item,
          showResponseDivider: awaitingResponseStart,
        });
        awaitingResponseStart = false;
        break;
      case 'toolCall':
        rows.push({
          kind: 'tool',
          id: item.id,
          item,
          showResponseDivider: awaitingResponseStart,
        });
        awaitingResponseStart = false;
        break;
      case 'error':
        rows.push({
          kind: 'error',
          id: item.id,
          item,
          showResponseDivider: awaitingResponseStart,
        });
        awaitingResponseStart = false;
        break;
    }
  }

  if (turnInProgress && !hasStreamingItem(messages, activities)) {
    rows.push({ kind: 'working', id: 'working-current-turn' });
  }

  return rows;
}

function reuseStableRow(previous: TimelineRow | undefined, next: TimelineRow): TimelineRow {
  if (!previous || previous.kind !== next.kind || previous.id !== next.id) {
    return next;
  }

  switch (next.kind) {
    case 'message':
      return previous.kind === 'message' &&
        previous.item === next.item &&
        previous.showResponseDivider === next.showResponseDivider &&
        previous.showAssistantMeta === next.showAssistantMeta
        ? previous
        : next;
    case 'thought':
      return previous.kind === 'thought' &&
        previous.item === next.item &&
        previous.showResponseDivider === next.showResponseDivider
        ? previous
        : next;
    case 'tool':
      return previous.kind === 'tool' &&
        previous.item === next.item &&
        previous.showResponseDivider === next.showResponseDivider
        ? previous
        : next;
    case 'error':
      return previous.kind === 'error' &&
        previous.item === next.item &&
        previous.showResponseDivider === next.showResponseDivider
        ? previous
        : next;
    case 'working':
      return previous;
  }
}

function hasStreamingItem(messages: ConversationMessage[], activities: ActivityItem[]): boolean {
  return messages.some((item) => item.streaming) ||
    activities.some((item) => item.kind === 'thought' && item.streaming);
}
