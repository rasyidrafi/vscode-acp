import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ChatItem, TimelineRow } from '../../src/shared/chatModel';
import { deriveTimelineRows } from './MessageTimeline.logic';

interface MessageTimelineProps {
  items: ChatItem[];
  turnInProgress: boolean;
}

export function MessageTimeline({ items, turnInProgress }: MessageTimelineProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<TimelineRow[]>([]);
  const shouldStickToBottomRef = useRef(true);
  const rows = useMemo(() => {
    const nextRows = deriveTimelineRows(items, {
      previousRows: rowsRef.current,
      turnInProgress,
    });
    rowsRef.current = nextRows;
    return nextRows;
  }, [items, turnInProgress]);

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
    case 'plan':
      return <PlanRow item={row.item} />;
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

function MessageRow({ item }: { item: Extract<ChatItem, { kind: 'message' }> }): ReactElement {
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
        {item.role === 'assistant' ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
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

function WorkRow({ items }: { items: Array<Extract<ChatItem, { kind: 'toolCall' | 'thought' }>> }): ReactElement {
  return (
    <section className="chat-row work-row" aria-label="Agent work">
      {items.map((item) => (
        item.kind === 'thought' ? <ThoughtRow key={item.id} item={item} /> : <ToolCallRow key={item.id} item={item} />
      ))}
    </section>
  );
}

function ThoughtRow({ item }: { item: Extract<ChatItem, { kind: 'thought' }> }): ReactElement {
  return (
    <details className="work-item thought-row" open={!item.collapsed}>
      <summary>{item.streaming ? 'Thinking...' : 'Thought'}</summary>
      <p>{item.text}</p>
    </details>
  );
}

function ToolCallRow({ item }: { item: Extract<ChatItem, { kind: 'toolCall' }> }): ReactElement {
  return (
    <article className={`work-item tool-row ${item.status}`}>
      <strong>{item.title}</strong>
      <span>{item.status}</span>
      {item.detail ? <p>{item.detail}</p> : null}
    </article>
  );
}

function PlanRow({ item }: { item: Extract<ChatItem, { kind: 'plan' }> }): ReactElement {
  return (
    <article className="chat-row plan-row">
      <strong>Plan</strong>
      <ul>
        {item.entries.map((entry) => (
          <li key={entry.id} className={entry.completed ? 'completed' : undefined}>
            {entry.text}
          </li>
        ))}
      </ul>
    </article>
  );
}

function ErrorRow({ item }: { item: Extract<ChatItem, { kind: 'error' }> }): ReactElement {
  return (
    <article className="chat-row inline-error-row">
      {item.text}
    </article>
  );
}
