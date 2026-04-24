import { useEffect, useReducer } from 'react';
import type { ReactElement } from 'react';

import type { ExtensionToWebviewMessage } from '../src/shared/bridge';
import { getPersistedState, postToExtension, setPersistedState } from './bridge';
import { ActivePlanPanel } from './components/ActivePlanPanel';
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
    const attachmentPrefix = state.attachedFiles.length > 0
      ? `Attached files:\n${state.attachedFiles.map((file) => `- ${file.path}`).join('\n')}\n\n`
      : '';
    const promptText = `${attachmentPrefix}${text}`;
    dispatch({ type: 'promptSubmitted', text });
    if (state.attachedFiles.length > 0) {
      dispatch({ type: 'attachmentsConsumed' });
    }
    postToExtension({ type: 'sendPrompt', text: promptText });
  }

  function cancelTurn(): void {
    postToExtension({ type: 'cancelTurn' });
  }

  const hasSession = Boolean(state.session);

  return (
    <main className={hasSession ? 'app-shell' : 'app-shell no-session'}>
      <section className="timeline-shell">
        {state.messages.length === 0 && state.activities.length === 0 ? (
          <div className={hasSession ? 'empty-state session-ready' : 'empty-state'}>
            <header className="empty-header">
              <div className="empty-welcome">
                <h1>{hasSession ? `Chatting with ${state.session?.agentName || 'Agent'}` : 'Welcome to ACP Client'}</h1>
                <p>
                  {hasSession
                    ? 'Ask for a change, investigation, or review.'
                    : 'Connect an AI coding agent to start building and chatting.'}
                </p>
              </div>
            </header>

            {!hasSession ? (
              <div className="empty-actions">
                <button
                  type="button"
                  className="empty-connect-button"
                  onClick={() => postToExtension({ type: 'executeCommand', command: 'acp.connectAgent' })}
                >
                  <i className="codicon codicon-plug" style={{ fontSize: '16px', marginRight: '8px' }}></i>
                  <span>Connect Agent</span>
                </button>              </div>
            ) : null}
          </div>
        ) : (
          <MessageTimeline
            messages={state.messages}
            activities={state.activities}
            turnInProgress={state.turnInProgress}
          />
        )}
      </section>

      {hasSession && state.activePlan ? (
        <ActivePlanPanel plan={state.activePlan} />
      ) : null}

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
            <i className="codicon codicon-close" style={{ fontSize: '14px' }}></i>
          </button>
        </div>
      ) : null}

      {hasSession ? (
        <>
          <SessionBanner
            session={state.session}
            modes={state.modes}
            models={state.models}
            onModeChange={(modeId) => postToExtension({ type: 'setMode', modeId })}
            onModelChange={(modelId) => postToExtension({ type: 'setModel', modelId })}
          />
          <ChatComposer
            hasSession={hasSession}
            turnInProgress={state.turnInProgress}
            availableCommands={state.availableCommands}
            attachedFiles={state.attachedFiles}
            onSubmit={submitPrompt}
            onCancel={cancelTurn}
            onAttachFile={() => postToExtension({ type: 'executeCommand', command: 'acp.attachFile' })}
            onRemoveAttachment={(path) => dispatch({ type: 'removeAttachment', path })}
          />
        </>
      ) : null}
    </main>
  );
}
