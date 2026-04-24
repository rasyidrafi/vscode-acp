import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type {
  ActivityItem,
  ConversationMessage,
  ErrorActivity,
  ThoughtActivity,
  TimelineRow,
  ToolCallActivity,
} from '../../src/shared/chatModel';
import { sanitizeMarkdownUrl } from '../lib/markdownLinks';
import { deriveTimelineRows } from './MessageTimeline.logic';

interface MessageTimelineProps {
  messages: ConversationMessage[];
  activities: ActivityItem[];
  turnInProgress: boolean;
}

export function MessageTimeline({ messages, activities, turnInProgress }: MessageTimelineProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<TimelineRow[]>([]);
  const shouldStickToBottomRef = useRef(true);
  const rows = useMemo(() => {
    const nextRows = deriveTimelineRows(messages, activities, {
      previousRows: rowsRef.current,
      turnInProgress,
    });
    rowsRef.current = nextRows;
    return nextRows;
  }, [messages, activities, turnInProgress]);

  useEffect(() => {
    if (!shouldStickToBottomRef.current) {
      return;
    }
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }, [rows]);

  return (
    <div
      ref={scrollRef}
      className="timeline-scroll"
      onScroll={() => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) {
          return;
        }
        const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
        shouldStickToBottomRef.current = distanceFromBottom < 32;
      }}
    >
      <div className="timeline-list">
        {rows.map((row) => (
          <TimelineRowView key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}

function TimelineRowView({ row }: { row: TimelineRow }): ReactElement {
  switch (row.kind) {
    case 'message':
      return <MessageRow item={row.item} />;
    case 'work':
      return <WorkRow items={row.items} />;
    case 'error':
      return <ErrorRow item={row.item} />;
    case 'working':
      return (
        <article className="chat-row working-row" aria-label="Agent is working">
          <span className="spinner-dot" />
          <span>Working</span>
        </article>
      );
  }
}

function MessageRow({ item }: { item: ConversationMessage }): ReactElement {
  const [copied, setCopied] = useState(false);
  const canCopy = item.role === 'assistant' && !item.streaming && item.text.trim().length > 0;

  async function copyMessage(): Promise<void> {
    if (!canCopy || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(item.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <article className={`chat-row message-row ${item.role}`}>
      <div className="message-content">
        {item.role === 'assistant' ? <div className="message-eyebrow">Response</div> : null}
        {item.role === 'assistant' ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={sanitizeMarkdownUrl}>{item.text}</ReactMarkdown>
        ) : (
          <p>{item.text}</p>
        )}
        {item.streaming ? <span className="streaming-dot" aria-label="Streaming" /> : null}
      </div>
      {canCopy ? (
        <button
          type="button"
          className="copy-button"
          title={copied ? 'Copied' : 'Copy message'}
          aria-label={copied ? 'Copied message' : 'Copy assistant message'}
          onClick={copyMessage}
        >
          {copied ? 'OK' : 'Copy'}
        </button>
      ) : null}
    </article>
  );
}

function WorkRow({ items }: { items: Array<ThoughtActivity | ToolCallActivity> }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const hasOverflow = items.length > 6;
  const visibleItems = hasOverflow && !expanded ? items.slice(-6) : items;
  const hiddenCount = items.length - visibleItems.length;

  return (
    <section className="chat-row work-row" aria-label="Agent work">
      <div className="work-row-header">
        <div>
          <strong>Work Log</strong>
          <span>{items.length} event{items.length === 1 ? '' : 's'}</span>
        </div>
        {hasOverflow ? (
          <button type="button" className="work-toggle-button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Show less' : `Show ${hiddenCount} more`}
          </button>
        ) : null}
      </div>
      <div className="work-row-list">
        {visibleItems.map((item) => (
          item.kind === 'thought' ? <ThoughtRow key={item.id} item={item} /> : <ToolCallRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function ThoughtRow({ item }: { item: ThoughtActivity }): ReactElement {
  return (
    <details className="work-item thought-row" open={!item.collapsed}>
      <summary>
        <span className="work-item-icon thinking" aria-hidden="true" />
        <span>{item.streaming ? 'Thinking' : 'Thought'}</span>
      </summary>
      <p>{item.text}</p>
    </details>
  );
}

function ToolCallRow({ item }: { item: ToolCallActivity }): ReactElement {
  const statusLabel = item.status === 'running'
    ? 'Running'
    : item.status === 'completed'
      ? 'Completed'
      : item.status === 'failed'
        ? 'Failed'
        : 'Pending';
  return (
    <article className={`work-item tool-row ${item.status}`}>
      <div className="tool-row-heading">
        <span className={`work-item-icon ${item.status}`} aria-hidden="true" />
        <strong>{item.title}</strong>
      </div>
      <span>{statusLabel}</span>
      {item.detail ? <p>{item.detail}</p> : null}
    </article>
  );
}

function ErrorRow({ item }: { item: ErrorActivity }): ReactElement {
  return (
    <article className="chat-row inline-error-row">
      {item.text}
    </article>
  );
}
