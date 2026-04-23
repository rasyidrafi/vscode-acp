import { useEffect, useReducer } from 'react';
import type { ReactElement } from 'react';

import type { BridgeSessionState, ExtensionToWebviewMessage } from '../src/shared/bridge';
import { postToExtension } from './bridge';

interface WebviewState {
  session: BridgeSessionState | null;
  activeSessionId: string | null;
  turnInProgress: boolean;
  error: string | null;
  updateCount: number;
}

type Action =
  | { type: 'state'; message: Extract<ExtensionToWebviewMessage, { type: 'state' }> }
  | { type: 'promptStart' }
  | { type: 'promptEnd' }
  | { type: 'error'; message: string }
  | { type: 'clearChat' }
  | { type: 'sessionUpdate' }
  | { type: 'modesUpdate'; message: Extract<ExtensionToWebviewMessage, { type: 'modesUpdate' }> }
  | { type: 'modelsUpdate'; message: Extract<ExtensionToWebviewMessage, { type: 'modelsUpdate' }> };

const initialState: WebviewState = {
  session: null,
  activeSessionId: null,
  turnInProgress: false,
  error: null,
  updateCount: 0,
};

function reducer(state: WebviewState, action: Action): WebviewState {
  switch (action.type) {
    case 'state':
      return {
        ...state,
        session: action.message.session,
        activeSessionId: action.message.activeSessionId,
      };
    case 'promptStart':
      return { ...state, turnInProgress: true, error: null };
    case 'promptEnd':
      return { ...state, turnInProgress: false };
    case 'error':
      return { ...state, error: action.message };
    case 'clearChat':
      return { ...state, error: null, updateCount: 0 };
    case 'sessionUpdate':
      return { ...state, updateCount: state.updateCount + 1 };
    case 'modesUpdate':
    case 'modelsUpdate':
      return state;
    default:
      return state;
  }
}

export function App(): ReactElement {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'state':
          dispatch({ type: 'state', message });
          break;
        case 'promptStart':
          dispatch({ type: 'promptStart' });
          break;
        case 'promptEnd':
          dispatch({ type: 'promptEnd' });
          break;
        case 'error':
          dispatch({ type: 'error', message: message.message });
          break;
        case 'clearChat':
          dispatch({ type: 'clearChat' });
          break;
        case 'sessionUpdate':
          dispatch({ type: 'sessionUpdate' });
          break;
        case 'modesUpdate':
          dispatch({ type: 'modesUpdate', message });
          break;
        case 'modelsUpdate':
          dispatch({ type: 'modelsUpdate', message });
          break;
      }
    };

    window.addEventListener('message', onMessage);
    postToExtension({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

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
        <div className="empty-state">
          <strong>React webview shell</strong>
          <span>Loaded and waiting for the Phase 3 reducer.</span>
          {state.updateCount > 0 ? <small>{state.updateCount} session updates received</small> : null}
        </div>
      </section>

      {state.error ? <div className="error-banner">{state.error}</div> : null}

      <footer className="composer-shell">
        <textarea aria-label="Prompt" placeholder="Ask the agent" disabled />
        <button type="button" disabled>
          {state.turnInProgress ? 'Cancel' : 'Send'}
        </button>
      </footer>
    </main>
  );
}
