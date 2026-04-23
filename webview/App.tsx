import { useEffect, useReducer, useState } from 'react';
import type { ReactElement } from 'react';

import type { ExtensionToWebviewMessage } from '../src/shared/bridge';
import { getPersistedState, postToExtension, setPersistedState } from './bridge';
import { MessageTimeline } from './components/MessageTimeline';
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
          <MessageTimeline items={state.items} turnInProgress={state.turnInProgress} />
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

function composerPlaceholder(state: WebviewState): string {
  if (!state.session) {
    return 'Connect to an agent';
  }
  if (state.availableCommands.length > 0) {
    return 'Ask the agent or type / for commands';
  }
  return 'Ask the agent';
}
