import { Check, Copy, ChevronRight, ChevronDown, Settings, Pencil, FilePlus, BookOpen, Terminal, Folder, Search, Brain } from 'lucide-react';
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
import { ToolCallContent } from './tools/ToolCallContent';

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
          showAssistantMeta={row.showAssistantMeta === true}
        />
      );
    case 'thought':
      return <ThoughtRow item={row.item} />;
    case 'tool':
      return <ToolCallRow item={row.item} />;
    case 'error':
      return <ErrorRow item={row.item} />;
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
    showAssistantMeta,
  }: { item: ConversationMessage; showAssistantMeta: boolean },
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
      </div>
    </article>
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
          <Check size={14} />
        ) : (
          <Copy size={14} />
        )}
      </button>
      <span className={`message-copy-tooltip${copied ? ' copied' : ''}`}>
        {copied ? 'Copied!' : 'Copy to clipboard'}
      </span>
    </span>
  );
}

function ThoughtRow({ item }: { item: ThoughtActivity }): ReactElement {
  const text = item.text.trim() || 'Thought';
  const [isOpen, setIsOpen] = useState(!item.collapsed);

  useEffect(() => {
    setIsOpen(!item.collapsed);
  }, [item.collapsed]);

  function handleHeaderClick(): void {
    setIsOpen(!isOpen);
  }

  return (
    <article className="chat-row thought-row">
      <div
        className="thought-row-header"
        onClick={handleHeaderClick}
        onKeyDown={(e) => e.key === 'Enter' && handleHeaderClick()}
        role="button"
        tabIndex={0}
      >
        <div className="thought-row-header-left">
          <div className="thought-row-visual">
            <div className={`thought-row-icon-layer${isOpen ? ' hidden' : ''}`} aria-hidden="true">
              <Brain size={14} />
            </div>
            <div className={`thought-row-chevron-layer${isOpen ? ' visible' : ''}`} aria-hidden="true">
              <ChevronRight
                size={12}
                style={{
                  display: 'inline-block',
                  transform: isOpen ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.1s ease',
                }}
              />
            </div>
          </div>
          <span className="thought-label">Thought</span>
        </div>
      </div>
      {isOpen && (
        <div className="thought-scroll-container">
          <div className="thought-content">{text}</div>
        </div>
      )}
    </article>
  );
}

function getToolIcon(toolName: string): ReactElement {
  const tool = toolName.toLowerCase();
  let Icon = Settings;

  if (tool.includes('edit') || tool.includes('patch') || tool.includes('replace')) {
    Icon = Pencil;
  } else if (tool.includes('write') || tool.includes('create')) {
    Icon = FilePlus;
  } else if (tool.includes('read') || tool.includes('view') || tool.includes('cat')) {
    Icon = BookOpen;
  } else if (tool.includes('bash') || tool.includes('shell') || tool.includes('cmd') || tool.includes('terminal') || tool.includes('run')) {
    Icon = Terminal;
  } else if (tool.includes('list') || tool.includes('ls')) {
    Icon = Folder;
  } else if (tool.includes('search') || tool.includes('grep') || tool.includes('find') || tool.includes('glob')) {
    Icon = Search;
  }

  return <Icon size={14} />;
}

function ToolCallRow({ item }: { item: ToolCallActivity }): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const title = item.title;
  const detail = item.detail;
  const lastLocation = item.locations && item.locations.length > 0
    ? item.locations[item.locations.length - 1].path
    : null;
  const preview = detail || lastLocation;
  const hasContent = !!(item.input || item.output || (item.locations && item.locations.length > 0));

  function handleHeaderClick(): void {
    if (hasContent || detail) {
      setIsOpen(!isOpen);
    }
  }

  return (
    <article className={`chat-row tool-row ${item.status}${hasContent || detail ? ' has-content' : ''}`}>
      <div
        className="tool-row-header"
        onClick={handleHeaderClick}
        onKeyDown={(e) => e.key === 'Enter' && handleHeaderClick()}
        role="button"
        tabIndex={hasContent || detail ? 0 : -1}
      >
        <div className="tool-row-header-left">
          <div className="tool-row-visual">
            <div className={`tool-row-icon-layer${isOpen ? ' hidden' : ''}`} aria-hidden="true">
              {getToolIcon(title)}
            </div>
            <div className={`tool-row-chevron-layer${isOpen ? ' visible' : ''}`} aria-hidden="true">
              <ChevronRight
                size={12}
                style={{
                  display: 'inline-block',
                  transform: isOpen ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.1s ease',
                }}
              />
            </div>
          </div>
          <span className="tool-row-title" title={title}>{title}</span>
        </div>
        {!isOpen && preview && (
          <span className="tool-row-preview" title={preview}>
            {preview}
          </span>
        )}
      </div>
      {isOpen && (
        <div className="tool-scroll-container">
          <div className="tool-row-content">
            <ToolCallContent item={item} />
          </div>
        </div>
      )}
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
  return firstLine;
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
