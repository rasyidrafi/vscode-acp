import type { ChatItem, TimelineRow } from '../../src/shared/chatModel';

export interface DeriveTimelineRowsOptions {
  previousRows?: TimelineRow[];
  turnInProgress?: boolean;
}

type WorkItem = Extract<ChatItem, { kind: 'toolCall' | 'thought' }>;

export function deriveTimelineRows(
  items: ChatItem[],
  options: DeriveTimelineRowsOptions = {},
): TimelineRow[] {
  const nextRows = buildRows(items, Boolean(options.turnInProgress));
  if (!options.previousRows || options.previousRows.length === 0) {
    return nextRows;
  }

  const previousById = new Map(options.previousRows.map((row) => [row.id, row]));
  return nextRows.map((row) => reuseStableRow(previousById.get(row.id), row));
}

function buildRows(items: ChatItem[], turnInProgress: boolean): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let workItems: WorkItem[] = [];

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

  for (const item of items) {
    switch (item.kind) {
      case 'thought':
      case 'toolCall':
        workItems.push(item);
        break;
      case 'message':
        flushWorkItems();
        rows.push({ kind: 'message', id: item.id, item });
        break;
      case 'plan':
        flushWorkItems();
        rows.push({ kind: 'plan', id: item.id, item });
        break;
      case 'error':
        flushWorkItems();
        rows.push({ kind: 'error', id: item.id, item });
        break;
    }
  }

  flushWorkItems();

  if (turnInProgress && !hasStreamingItem(items)) {
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
    case 'plan':
      return previous.kind === 'plan' && previous.item === next.item ? previous : next;
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

function hasStreamingItem(items: ChatItem[]): boolean {
  return items.some((item) => (
    (item.kind === 'message' || item.kind === 'thought') && item.streaming
  ));
}
