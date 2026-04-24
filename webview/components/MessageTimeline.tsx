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
      return (
        <MessageRow
          item={row.item}
          showResponseDivider={row.showResponseDivider === true}
          showAssistantMeta={row.showAssistantMeta === true}
        />
      );
    case 'thought':
      return <ThoughtRow item={row.item} showResponseDivider={row.showResponseDivider === true} />;
    case 'tool':
      return <ToolCallRow item={row.item} showResponseDivider={row.showResponseDivider === true} />;
    case 'error':
      return <ErrorRow item={row.item} showResponseDivider={row.showResponseDivider === true} />;
    case 'working':
      return (
        <article className="chat-row working-row" aria-label="Agent is working">
          <span className="spinner-dot" />
          <span>Working</span>
        </article>
      );
  }
}

function MessageRow(
  {
    item,
    showResponseDivider,
    showAssistantMeta,
  }: { item: ConversationMessage; showResponseDivider: boolean; showAssistantMeta: boolean },
): ReactElement {
  const isAssistant = item.role === 'assistant';
  const showMeta = !isAssistant || showAssistantMeta;
  const canCopy = showMeta && !item.streaming && item.text.trim().length > 0;
  const renderedText = isAssistant && !item.streaming && item.text.trim().length === 0
    ? '(empty response)'
    : item.text;
  const timestamp = showMeta ? formatMessageTime(item.createdAt) : null;

  return (
    <article className={`chat-row message-row ${item.role}`}>
      {showResponseDivider ? <ResponseDivider /> : null}
      <div className="message-content">
        {isAssistant ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={sanitizeMarkdownUrl}>{renderedText}</ReactMarkdown>
        ) : (
          <p>{renderedText}</p>
        )}
        {showMeta ? (
          <div className={`message-meta ${isAssistant ? 'assistant-meta' : 'user-meta'}`}>
            {isAssistant ? (
              <>
                {timestamp ? <span>{timestamp}</span> : null}
                {canCopy ? <MessageCopyButton text={item.text} /> : null}
              </>
            ) : (
              <>
                {canCopy ? <MessageCopyButton text={item.text} /> : null}
                {timestamp ? <span>{timestamp}</span> : null}
              </>
            )}
          </div>
        ) : null}
        {item.streaming ? <span className="streaming-dot" aria-label="Streaming" /> : null}
      </div>
    </article>
  );
}

function ResponseDivider(): ReactElement {
  return (
    <div className="response-divider" aria-hidden="true">
      <span />
      <small>Response</small>
      <span />
    </div>
  );
}

function MessageCopyButton({ text }: { text: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  async function copyMessage(): Promise<void> {
    if (!navigator.clipboard || copied) {
      return;
    }
    await navigator.clipboard.writeText(text);
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    setCopied(true);
    timeoutRef.current = window.setTimeout(() => {
      setCopied(false);
      timeoutRef.current = null;
    }, 1000);
  }

  return (
    <span className="message-copy-wrap">
      <button
        type="button"
        className={`message-inline-copy${copied ? ' copied' : ''}`}
        aria-label={copied ? 'Copied!' : 'Copy to clipboard'}
        onClick={copyMessage}
        disabled={copied}
      >
        {copied ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3.5 8.25 6.2 11l6.3-6.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="5" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <rect x="3" y="5" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        )}
      </button>
      <span className={`message-copy-tooltip${copied ? ' copied' : ''}`}>
        {copied ? 'Copied!' : 'Copy to clipboard'}
      </span>
    </span>
  );
}

function ThoughtRow(
  { item, showResponseDivider }: { item: ThoughtActivity; showResponseDivider: boolean },
): ReactElement {
  const text = item.text.trim() || (item.streaming ? 'Thinking' : 'Thought');
  const [isOpen, setIsOpen] = useState(!item.collapsed);

  useEffect(() => {
    setIsOpen(!item.collapsed);
  }, [item.collapsed]);

  return (
    <article className="chat-row thought-row">
      {showResponseDivider ? <ResponseDivider /> : null}
      <details
        className="thought-details"
        open={isOpen}
        onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="thought-summary">
          <span className="thought-chevron" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path
                d="M6 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="chevron-right"
              />
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="chevron-down"
              />
            </svg>
          </span>
          <span className="thought-label">{item.streaming ? 'Thinking' : 'Thought'}</span>
        </summary>
      </details>
      {isOpen ? (
        <div className="thought-scroll-container">
          <div className="thought-content">{text}</div>
        </div>
      ) : null}
    </article>
  );
}

function ToolCallRow(
  { item, showResponseDivider }: { item: ToolCallActivity; showResponseDivider: boolean },
): ReactElement {
  const preview = item.detail && normalizeToolPreview(item.detail, item.title);
  const text = preview ? `${item.title} - ${preview}` : item.title;

  return (
    <article className={`chat-row tool-card ${item.status}`}>
      {showResponseDivider ? <ResponseDivider /> : null}
      <div className="tool-row-heading">
        <span className="tool-row-glyph" aria-hidden="true">
          {'>_'}
        </span>
        <p title={text}>{text}</p>
      </div>
    </article>
  );
}

function ErrorRow(
  { item, showResponseDivider }: { item: ErrorActivity; showResponseDivider: boolean },
): ReactElement {
  return (
    <article className="chat-row inline-error-row">
      {showResponseDivider ? <ResponseDivider /> : null}
      {item.text}
    </article>
  );
}

function normalizeToolPreview(detail: string, title: string): string | null {
  const trimmed = detail.trim();
  if (!trimmed) {
    return null;
  }

  const firstLine = trimmed.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? trimmed;
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedLine = firstLine.trim().toLowerCase();
  if (normalizedTitle === normalizedLine) {
    return null;
  }
  return firstLine.length > 120 ? `${firstLine.slice(0, 117).trimEnd()}...` : firstLine;
}

function formatMessageTime(value?: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}
