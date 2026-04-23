import { useEffect, useReducer } from 'react';
import type { ReactElement } from 'react';

import type { ExtensionToWebviewMessage } from '../src/shared/bridge';
import { getPersistedState, postToExtension, setPersistedState } from './bridge';
import { ChatComposer } from './components/ChatComposer';
import { MessageTimeline } from './components/MessageTimeline';
import { SessionBanner } from './components/SessionBanner';
import { createInitialState, toPersistedState } from './state';
import { reduceWebviewState } from './state.logic';

export function App(): ReactElement {
  const [state, dispatch] = useReducer(
    reduceWebviewState,
    undefined,
    () => createInitialState(getPersistedState()),
  );

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

  function submitPrompt(text: string): void {
    dispatch({ type: 'promptSubmitted', text });
    postToExtension({ type: 'sendPrompt', text });
  }

  function cancelTurn(): void {
    postToExtension({ type: 'cancelTurn' });
  }

  return (
    <main className="app-shell">
      <SessionBanner
        session={state.session}
        modes={state.modes}
        models={state.models}
        onModeChange={(modeId) => postToExtension({ type: 'setMode', modeId })}
        onModelChange={(modelId) => postToExtension({ type: 'setModel', modelId })}
      />

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

      <ChatComposer
        hasSession={Boolean(state.session)}
        turnInProgress={state.turnInProgress}
        availableCommands={state.availableCommands}
        onSubmit={submitPrompt}
        onCancel={cancelTurn}
      />
    </main>
  );
}
