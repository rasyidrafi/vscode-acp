import { useEffect, useReducer, useState } from 'react';
import type { ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ExtensionToWebviewMessage } from '../src/shared/bridge';
import type { ChatItem } from '../src/shared/chatModel';
import { getPersistedState, postToExtension, setPersistedState } from './bridge';
import { createInitialState, toPersistedState } from './state';
import type { WebviewState } from './state';
import { reduceWebviewState } from './state.logic';

export function App(): ReactElement {
  const [state, dispatch] = useReducer(
    reduceWebviewState,
    undefined,
    () => createInitialState(getPersistedState()),
  );
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      dispatch({ type: 'extensionMessage', message: event.data });
    };

    window.addEventListener('message', onMessage);
    postToExtension({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    setPersistedState(toPersistedState(state));
  }, [state]);

  const canSend = Boolean(state.session) && prompt.trim().length > 0 && !state.turnInProgress;

  function submitPrompt(): void {
    const text = prompt.trim();
    if (!canSend) {
      return;
    }
    dispatch({ type: 'promptSubmitted', text });
    postToExtension({ type: 'sendPrompt', text });
    setPrompt('');
  }

  function cancelTurn(): void {
    postToExtension({ type: 'cancelTurn' });
  }

  return (
    <main className="app-shell">
      <section className="session-strip" aria-live="polite">
        <span className={state.session ? 'status-dot connected' : 'status-dot'} />
        <div className="session-copy">
          <strong>{state.session?.agentName ?? 'No active agent'}</strong>
          <span>{state.session?.cwd ?? 'Connect to an agent to start chatting.'}</span>
        </div>
      </section>

      <section className="timeline-shell">
        {state.items.length === 0 ? (
          <div className="empty-state">
            <strong>{state.session ? 'Ready' : 'No active agent'}</strong>
            <span>{state.session ? 'Ask the agent to start a conversation.' : 'Connect to an agent to start chatting.'}</span>
            {state.availableCommands.length > 0 ? <small>{state.availableCommands.length} commands available</small> : null}
          </div>
        ) : (
          <div className="timeline-list">
            {state.items.map((item) => (
              <ChatItemRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      {state.error ? (
        <div className="error-banner">
          <span>{state.error}</span>
          <button
            type="button"
            aria-label="Clear error"
            onClick={() => {
              dispatch({ type: 'clearError' });
              postToExtension({ type: 'clearError' });
            }}
          >
            x
          </button>
        </div>
      ) : null}

      <footer className="composer-shell">
        <textarea
          aria-label="Prompt"
          placeholder={composerPlaceholder(state)}
          value={prompt}
          disabled={!state.session}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submitPrompt();
            }
          }}
        />
        <button
          type="button"
          disabled={state.turnInProgress ? false : !canSend}
          onClick={state.turnInProgress ? cancelTurn : submitPrompt}
        >
          {state.turnInProgress ? 'Cancel' : 'Send'}
        </button>
      </footer>
    </main>
  );
}

function ChatItemRow({ item }: { item: ChatItem }): ReactElement {
  switch (item.kind) {
    case 'message':
      return (
        <article className={`chat-row message-row ${item.role}`}>
          {item.role === 'assistant' ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
          ) : (
            <p>{item.text}</p>
          )}
          {item.streaming ? <span className="streaming-dot" aria-label="Streaming" /> : null}
        </article>
      );
    case 'thought':
      return (
        <details className="chat-row thought-row" open={!item.collapsed}>
          <summary>{item.streaming ? 'Thinking...' : 'Thought'}</summary>
          <p>{item.text}</p>
        </details>
      );
    case 'toolCall':
      return (
        <article className={`chat-row tool-row ${item.status}`}>
          <strong>{item.title}</strong>
          <span>{item.status}</span>
          {item.detail ? <p>{item.detail}</p> : null}
        </article>
      );
    case 'plan':
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
    case 'error':
      return (
        <article className="chat-row inline-error-row">
          {item.text}
        </article>
      );
    default:
      return <></>;
  }
}

function composerPlaceholder(state: WebviewState): string {
  if (!state.session) {
    return 'Connect to an agent';
  }
  if (state.availableCommands.length > 0) {
    return 'Ask the agent or type / for commands';
  }
  return 'Ask the agent';
}
