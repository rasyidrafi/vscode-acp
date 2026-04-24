import { Plug, X } from 'lucide-react';
import { useEffect, useReducer, useState } from 'react';
import type { ReactElement } from 'react';

import type { ExtensionToWebviewMessage } from '../src/shared/bridge';
import { getPersistedState, postToExtension, setPersistedState } from './bridge';
import { ActivePlanPanel } from './components/ActivePlanPanel';
import { ChatComposer } from './components/ChatComposer';
import type { ComposerMenuState } from './components/ChatComposer';
import { ComposerCommandMenu } from './components/ComposerCommandMenu';
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
  const [composerMenuState, setComposerMenuState] = useState<ComposerMenuState | null>(null);

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
                <h1>{hasSession ? `Chat with ${state.session?.agentName || 'Agent'}` : 'Welcome to ACP Client'}</h1>
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
                  <Plug size={16} style={{ marginRight: '8px' }} />
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
            <X size={14} />
          </button>
        </div>
      ) : null}

      {hasSession ? (
        <>
          <div className="session-header-stack">
            {composerMenuState ? (
              <ComposerCommandMenu
                className="header-command-menu"
                commands={composerMenuState.commands}
                activeIndex={composerMenuState.activeIndex}
                emptyStateText="No commands available for this agent"
                onHover={composerMenuState.onHover}
                onSelect={composerMenuState.onSelect}
              />
            ) : null}
            <SessionBanner
              session={state.session}
              modes={state.modes}
              models={state.models}
              onModeChange={(modeId) => postToExtension({ type: 'setMode', modeId })}
              onModelChange={(modelId) => postToExtension({ type: 'setModel', modelId })}
            />
          </div>
          <ChatComposer
            hasSession={hasSession}
            turnInProgress={state.turnInProgress}
            availableCommands={state.availableCommands}
            modes={state.modes}
            attachedFiles={state.attachedFiles}
            onSubmit={submitPrompt}
            onCancel={cancelTurn}
            onAttachFile={() => postToExtension({ type: 'executeCommand', command: 'acp.attachFile' })}
            onRemoveAttachment={(path) => dispatch({ type: 'removeAttachment', path })}
            onModeChange={(modeId) => postToExtension({ type: 'setMode', modeId })}
            onCommandMenuChange={setComposerMenuState}
          />
        </>
      ) : null}
    </main>
  );
}
