export type ChatRole = 'user' | 'assistant' | 'system';

export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface PlanEntry {
  id: string;
  text: string;
  completed?: boolean;
}

export type ChatItem =
  | {
      kind: 'message';
      id: string;
      role: ChatRole;
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
      status: ToolCallStatus;
      detail?: string;
    }
  | {
      kind: 'plan';
      id: string;
      entries: PlanEntry[];
    }
  | {
      kind: 'error';
      id: string;
      text: string;
    };

export type TimelineRow =
  | {
      kind: 'message';
      id: string;
      item: Extract<ChatItem, { kind: 'message' }>;
    }
  | {
      kind: 'work';
      id: string;
      items: Array<Extract<ChatItem, { kind: 'toolCall' | 'thought' }>>;
    }
  | {
      kind: 'plan';
      id: string;
      item: Extract<ChatItem, { kind: 'plan' }>;
    }
  | {
      kind: 'error';
      id: string;
      item: Extract<ChatItem, { kind: 'error' }>;
    }
  | {
      kind: 'working';
      id: string;
    };
