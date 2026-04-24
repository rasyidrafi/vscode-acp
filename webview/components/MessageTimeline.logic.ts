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
  let workItems: WorkItem[] = [];
  const mergedItems = [...messages, ...activities].sort((left, right) => left.order - right.order);

  function flushWorkItems(): void {
    if (workItems.length === 0) {
      return;
    }

    const first = workItems[0];
    const last = workItems[workItems.length - 1];
    rows.push({
      kind: 'work',
      id: first.id === last.id ? `work-${first.id}` : `work-${first.id}-${last.id}`,
      items: workItems,
    });
    workItems = [];
  }

  for (const item of mergedItems) {
    switch (item.kind) {
      case 'thought':
      case 'toolCall':
        workItems.push(item);
        break;
      case 'message':
        flushWorkItems();
        rows.push({ kind: 'message', id: item.id, item });
        break;
      case 'error':
        flushWorkItems();
        rows.push({ kind: 'error', id: item.id, item });
        break;
    }
  }

  flushWorkItems();

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
      return previous.kind === 'message' && previous.item === next.item ? previous : next;
    case 'error':
      return previous.kind === 'error' && previous.item === next.item ? previous : next;
    case 'work':
      return previous.kind === 'work' &&
        previous.items.length === next.items.length &&
        previous.items.every((item, index) => item === next.items[index])
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
