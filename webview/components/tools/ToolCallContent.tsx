import type { ReactElement } from 'react';

import type { ToolCallActivity } from '../../../src/shared/chatModel';
import {
  diffWords,
  extractCommand,
  extractEditData,
  extractOutputText,
  extractSearchData,
  inferToolRenderer,
  parseMaybeJson,
  stringifyUnknown,
  type DiffPart,
} from './toolRenderUtils';

interface ToolCallContentProps {
  item: ToolCallActivity;
}

export function ToolCallContent({ item }: ToolCallContentProps): ReactElement {
  const parsedInput = parseMaybeJson(item.input);
  const parsedOutput = parseMaybeJson(item.output);
  const renderer = inferToolRenderer(item, parsedInput);

  return (
    <div className="tool-content-wrapper">
      <ToolMainContent
        renderer={renderer}
        item={item}
        input={parsedInput}
        output={parsedOutput}
      />
      {item.locations && item.locations.length > 0 && (
        <LocationList locations={item.locations} />
      )}
    </div>
  );
}

function ToolMainContent(
  { renderer, item, input, output }:
  { renderer: ToolRendererKind; item: ToolCallActivity; input: unknown; output: unknown },
): ReactElement | null {
  switch (renderer) {
    case 'bash':
      return <BashToolContent item={item} input={input} output={output} />;
    case 'edit':
      return <EditToolContent item={item} input={input} output={output} />;
    case 'search':
      return <SearchToolContent item={item} input={input} output={output} />;
    case 'read':
      return <ReadToolContent item={item} />;
    default:
      return <GenericToolContent item={item} />;
  }
}

function ReadToolContent(
  { item }: { item: ToolCallActivity },
): ReactElement | null {
  if (!item.detail) {
    return null;
  }

  return (
    <div className="tool-read-content">
      <div className="tool-read-detail">{item.detail}</div>
    </div>
  );
}

function BashToolContent(
  { item, input, output }: { item: ToolCallActivity; input: unknown; output: unknown },
): ReactElement {
  const command = extractCommand(input, item.detail);
  const outputText = extractOutputText(output).trim();

  return (
    <div className="tool-bash-content">
      <div className="tool-terminal-window">
        {command ? (
          <div className="tool-terminal-command">
            <span className="tool-terminal-prompt">$</span>
            <code>{command}</code>
          </div>
        ) : null}
        {outputText ? (
          <pre className="tool-terminal-output">{outputText}</pre>
        ) : item.status === 'completed' ? (
          <div className="tool-empty-note">No command output</div>
        ) : null}
      </div>
    </div>
  );
}

function LocationList({
  locations,
}: {
  locations: Array<{ path: string }>;
}): ReactElement {
  if (locations.length === 0) {
    return <></>;
  }

  return (
    <div className="tool-locations-section">
      <div className="tool-search-results-container" style={{ maxHeight: '160px' }}>
        <div className="tool-search-files">
          {locations.map((loc, idx) => (
            <button
              key={`${loc.path}-${idx}`}
              type="button"
              className="tool-search-file"
              onClick={() => {
                void navigator.clipboard?.writeText(loc.path);
              }}
            >
              {loc.path}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchToolContent(
  { item, input, output }: { item: ToolCallActivity; input: unknown; output: unknown },
): ReactElement {
  const { query, scope, result } = extractSearchData(input, output, item.detail);
  const hasStructuredMatches = result.files.length > 0 || result.matches.length > 0;

  return (
    <div className="tool-search-content">
      {query ? (
        <div className="tool-search-meta">
          <code>{query}</code>
          {scope ? <span className="tool-search-scope">in {scope}</span> : null}
        </div>
      ) : null}

      {hasStructuredMatches ? (
        <div className="tool-search-results-container">
          {result.files.length > 0 ? (
            <div className="tool-search-files">
              {result.files.map((file) => (
                <button
                  key={file}
                  type="button"
                  className="tool-search-file"
                  title="Click to copy file path"
                  onClick={() => {
                    void navigator.clipboard?.writeText(file);
                  }}
                >
                  {file}
                </button>
              ))}
            </div>
          ) : null}

          {result.matches.length > 0 ? (
            <div className="tool-search-matches">
              {result.matches.map((match, index) => (
                <div key={`${match.file}-${match.line ?? 0}-${index}`} className="tool-search-match">
                  <span className="tool-search-match-file">{match.file}</span>
                  {typeof match.line === 'number' ? <span className="tool-search-match-line">:{match.line}</span> : null}
                  <span className="tool-search-match-text">{match.text}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {!hasStructuredMatches && result.rawText ? (
        <pre className="tool-code-block">{result.rawText}</pre>
      ) : null}

      {!hasStructuredMatches && !result.rawText ? (
        <div className="tool-empty-note">No matches</div>
      ) : null}
    </div>
  );
}

function EditToolContent(
  { item, input, output }: { item: ToolCallActivity; input: unknown; output: unknown },
): ReactElement {
  const { path, oldText, newText, diffText } = extractEditData(input, output);

  if (oldText !== undefined || newText !== undefined) {
    const oldValue = oldText ?? '';
    const newValue = newText ?? '';
    const { oldParts, newParts } = diffWords(oldValue, newValue);

    return (
      <div className="tool-edit-content">
        {path ? <div className="tool-edit-path">{path}</div> : null}
        <div className="tool-edit-lines">
          <DiffLine prefix="-" variant="removed" parts={oldParts} />
          <DiffLine prefix="+" variant="added" parts={newParts} />
        </div>
      </div>
    );
  }

  if (diffText) {
    return <UnifiedDiffContent diffText={diffText} path={path} />;
  }

  return <GenericToolContent item={item} />;
}

function UnifiedDiffContent({ diffText, path }: { diffText: string; path?: string }): ReactElement {
  const lines = diffText.split(/\r?\n/u);
  const rows: ReactElement[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('@@')) {
      rows.push(<div key={`hunk-${index}`} className="tool-diff-hunk">{line}</div>);
      continue;
    }

    const nextLine = lines[index + 1];
    if (line.startsWith('-') && nextLine?.startsWith('+')) {
      const oldValue = line.slice(1);
      const newValue = nextLine.slice(1);
      const { oldParts, newParts } = diffWords(oldValue, newValue);
      rows.push(<DiffLine key={`remove-${index}`} prefix="-" variant="removed" parts={oldParts} />);
      rows.push(<DiffLine key={`add-${index + 1}`} prefix="+" variant="added" parts={newParts} />);
      index += 1;
      continue;
    }

    const variant = line.startsWith('+')
      ? 'added'
      : line.startsWith('-')
        ? 'removed'
        : 'context';
    rows.push(
      <div key={`line-${index}`} className={`tool-diff-line ${variant}`}>
        {line}
      </div>,
    );
  }

  return (
    <div className="tool-edit-content">
      {path ? <div className="tool-edit-path">{path}</div> : null}
      <div className="tool-edit-lines">{rows}</div>
    </div>
  );
}

function DiffLine(
  { prefix, variant, parts }: { prefix: string; variant: 'added' | 'removed'; parts: DiffPart[] },
): ReactElement {
  return (
    <div className={`tool-diff-line ${variant}`}>
      <span className="tool-diff-prefix">{prefix}</span>
      <span className="tool-diff-body">
        {parts.map((part, index) => (
          <span
            key={`${part.changed ? 'changed' : 'plain'}-${index}`}
            className={part.changed ? 'tool-diff-word-changed' : undefined}
          >
            {part.text}
          </span>
        ))}
      </span>
    </div>
  );
}

function GenericToolContent({ item }: { item: ToolCallActivity }): ReactElement {
  const parsedInput = parseMaybeJson(item.input);
  const parsedOutput = parseMaybeJson(item.output);

  const inputStr = item.input ? stringifyUnknown(parsedInput) : null;
  const outputStr = item.output ? stringifyUnknown(parsedOutput) : null;

  return (
    <>
      {inputStr && inputStr !== item.detail ? (
        <ToolSection label="Input">
          <pre className="tool-code-block"><code>{inputStr}</code></pre>
        </ToolSection>
      ) : null}
      {outputStr && outputStr !== item.detail ? (
        <ToolSection label="Output">
          <pre className="tool-code-block"><code>{outputStr}</code></pre>
        </ToolSection>
      ) : null}
    </>
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
