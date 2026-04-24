export type ChatRole = 'user' | 'assistant' | 'system';

export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'failed';

export type PlanEntryStatus = 'pending' | 'inProgress' | 'completed';

export interface PlanEntry {
  id: string;
  text: string;
  status: PlanEntryStatus;
}

export interface ActivePlan {
  id: string;
  explanation?: string;
  entries: PlanEntry[];
}

interface OrderedTimelineItem {
  order: number;
}

export interface ConversationMessage extends OrderedTimelineItem {
  kind: 'message';
  id: string;
  role: ChatRole;
  text: string;
  streaming?: boolean;
}

export interface ThoughtActivity extends OrderedTimelineItem {
  kind: 'thought';
  id: string;
  text: string;
  streaming?: boolean;
  collapsed?: boolean;
}

export interface ToolCallActivity extends OrderedTimelineItem {
  kind: 'toolCall';
  id: string;
  title: string;
  status: ToolCallStatus;
  detail?: string;
}

export interface ErrorActivity extends OrderedTimelineItem {
  kind: 'error';
  id: string;
  text: string;
}

export type ActivityItem = ThoughtActivity | ToolCallActivity | ErrorActivity;
export type ChatItem = ConversationMessage | ActivityItem;

export type TimelineRow =
  | {
      kind: 'message';
      id: string;
      item: ConversationMessage;
    }
  | {
      kind: 'work';
      id: string;
      items: Array<Extract<ActivityItem, { kind: 'toolCall' | 'thought' }>>;
    }
  | {
      kind: 'error';
      id: string;
      item: ErrorActivity;
    }
  | {
      kind: 'working';
      id: string;
    };
