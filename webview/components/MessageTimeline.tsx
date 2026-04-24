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
          <span className="working-dots">
            <span className="working-dot" />
            <span className="working-dot" />
            <span className="working-dot" />
          </span>
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

function getToolIcon(toolName: string): ReactElement {
  const tool = toolName.toLowerCase();
  // Simplified paths for 16x16 viewbox
  if (tool.includes('edit') || tool.includes('patch') || tool.includes('replace')) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59V15h1.41l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2 14v-.69l2.12-1.21 1.21 2.12L2 14.91V14zM6.04 13.5l-1.41-1.41L11.77 5 13.18 6.41 6.04 13.5zM14 5.01L12.59 6.42 11.18 5 12.59 3.59 14 5.01z" />
      </svg>
    );
  }
  if (tool.includes('write') || tool.includes('create')) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M13 0H3L2 1v14l1 1h10l1-1V1l-1-1zm0 15H3V1h10v14zM4 4h8v1H4V4zm0 3h8v1H4V7zm0 3h8v1H4v-1z" />
      </svg>
    );
  }
  if (tool.includes('read') || tool.includes('view') || tool.includes('cat')) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M13.5 1h-11l-.5.5v13l.5.5h11l.5-.5v-13l-.5-.5zM13 14H3V2h10v12zM4 4h8v1H4V4zm0 3h8v1H4V7zm0 3h5v1H4v-1z" />
      </svg>
    );
  }
  if (tool.includes('bash') || tool.includes('shell') || tool.includes('cmd') || tool.includes('terminal')) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M0 2l1-1h14l1 1v12l-1 1H1l-1-1V2zm1 1v11h14V3H1zm2.5 2.1l.7-.7 3.1 3.1L4.2 10.6l-.7-.7 2.4-2.4-2.4-2.4zM7 9h5v1H7V9z" />
      </svg>
    );
  }
  if (tool.includes('list') || tool.includes('ls')) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M14.5 3H7.71l-2-2H1.5l-.5.5v12l.5.5h13l.5-.5v-10l-.5-.5zm-.5 10H2V2h3.79l2 2H14v9z" />
      </svg>
    );
  }
  if (tool.includes('search') || tool.includes('grep') || tool.includes('find') || tool.includes('glob')) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.87 10.81l4.08 4.08-.71.71-4.08-4.08a6.5 6.5 0 1 1 .71-.71zM6.5 12A5.5 5.5 0 1 0 1 6.5 5.506 5.506 0 0 0 6.5 12z" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M14.2 9l-.1-1.3-.2-.5h.1l.1-.3-.6-1.1-.3.1h-.1l-.4-.3-.4-.8-.1-.1h.1l-.1-.3-.6-1-.3.1h-.1l-.5-.2-.9-.1H10l-.1-.1-.3-.1-.6-1-.3.1-.1.1-.5-.1h-.1l-.5.1-.3 1-.6 1-.3-.1-.1.1-.2.1-.9.1h-.1l-.5.2-.1-.1-.3-.1-.6 1-.1.3h.1l-.1.1-.4.8-.4.3h-.1l-.3-.1-.6 1.1.1.3h.1l-.2.5-.1 1.3h.1l.1.3-.1 1-.3.1-.1.3.6 1.1.3-.1h.1l.4.3.4.8h-.1l.1.3.6 1 .3-.1h.1l.5.2.9.1.1.1.1.1.3.1.6 1 .3-.1.1-.1.5.1h.1l.5-.1.3-1 .6-1 .3.1.1-.1.2-.1.9-.1h.1l.5-.2.1.1.3.1.6-1 .1-.3h-.1l.1-.1.4-.8.4-.3h.1l.3.1.6-1.1-.1-.3h-.1l.2-.5.1-.3zM8 10.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}

function ToolCallRow(
  { item, showResponseDivider }: { item: ToolCallActivity; showResponseDivider: boolean },
): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const preview = item.detail && normalizeToolPreview(item.detail, item.title);
  const title = item.title;
  const hasContent = !!(item.input || item.output || item.detail);

  function handleHeaderClick(): void {
    if (hasContent) {
      setIsOpen(!isOpen);
    }
  }

  return (
    <article className={`chat-row tool-row ${item.status}${hasContent ? ' has-content' : ''}`}>
      {showResponseDivider ? <ResponseDivider /> : null}
      <div
        className="tool-row-header"
        onClick={handleHeaderClick}
        onKeyDown={(e) => e.key === 'Enter' && handleHeaderClick()}
        role="button"
        tabIndex={hasContent ? 0 : -1}
      >
        <div className="tool-row-header-left">
          <div className="tool-row-visual">
            <div className={`tool-row-icon-layer${isOpen ? ' hidden' : ''}`} aria-hidden="true">
              {getToolIcon(title)}
            </div>
            <div className={`tool-row-chevron-layer${isOpen ? ' visible' : ''}`} aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}>
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          <span className="tool-row-title">{title}</span>
        </div>
        {!isOpen && preview && (
          <span className="tool-row-preview" title={item.detail}>
            {preview}
          </span>
        )}
      </div>
      {isOpen && (
        <div className="tool-row-content">
          {item.input ? (
            <ToolSection label="Input">
              <pre>{item.input}</pre>
            </ToolSection>
          ) : null}
          {item.output ? (
            <ToolSection label="Output">
              <pre>{item.output}</pre>
            </ToolSection>
          ) : item.detail ? (
            <ToolSection label="Detail">
              <pre>{item.detail}</pre>
            </ToolSection>
          ) : null}
        </div>
      )}
    </article>
  );
}

function ToolSection({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <div className="tool-section">
      <div className="tool-section-label">{label}</div>
      <div className="tool-section-body">{children}</div>
    </div>
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
