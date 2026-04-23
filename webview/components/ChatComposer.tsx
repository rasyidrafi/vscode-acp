import type { AvailableCommand } from '@agentclientprotocol/sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';

import { searchCommands } from '../lib/commandSearch';
import { ComposerCommandMenu } from './ComposerCommandMenu';
import {
  commandInputHint,
  commandNeedsInput,
  commandPrompt,
  getComposerSendState,
  getSlashCommandQuery,
} from './ChatComposer.logic';

interface ChatComposerProps {
  hasSession: boolean;
  turnInProgress: boolean;
  availableCommands: AvailableCommand[];
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function ChatComposer({
  hasSession,
  turnInProgress,
  availableCommands,
  onSubmit,
  onCancel,
}: ChatComposerProps): ReactElement {
  const [prompt, setPrompt] = useState('');
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [commandHint, setCommandHint] = useState<string | null>(null);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const slashQuery = getSlashCommandQuery(prompt);
  const commandResults = useMemo(() => (
    slashQuery === null ? [] : searchCommands(availableCommands, slashQuery)
  ), [availableCommands, slashQuery]);
  const menuOpen = slashQuery !== null &&
    slashQuery !== dismissedQuery &&
    commandResults.length > 0 &&
    !turnInProgress;
  const sendState = getComposerSendState({
    hasSession,
    prompt,
    turnInProgress,
    availableCommandCount: availableCommands.length,
    commandInputHint: commandHint,
  });

  useEffect(() => {
    setActiveCommandIndex(0);
    setDismissedQuery(null);
  }, [slashQuery]);

  useEffect(() => {
    if (!prompt.startsWith('/')) {
      setCommandHint(null);
    }
  }, [prompt]);

  function submitPrompt(text = prompt): void {
    const trimmed = text.trim();
    if (!hasSession || turnInProgress || !trimmed) {
      return;
    }
    onSubmit(trimmed);
    setPrompt('');
    setCommandHint(null);
  }

  function selectCommand(command: AvailableCommand): void {
    const nextPrompt = commandPrompt(command);
    if (commandNeedsInput(command)) {
      setPrompt(`${nextPrompt} `);
      setCommandHint(commandInputHint(command));
      window.setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }

    submitPrompt(nextPrompt);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (menuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveCommandIndex((index) => Math.min(index + 1, commandResults.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveCommandIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        const activeCommand = commandResults[activeCommandIndex];
        if (activeCommand) {
          selectCommand(activeCommand.command);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissedQuery(slashQuery);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (turnInProgress) {
        onCancel();
      } else {
        submitPrompt();
      }
    }
  }

  return (
    <footer className="composer-shell">
      <div className="composer-input-wrap">
        <ComposerCommandMenu
          commands={menuOpen ? commandResults : []}
          activeIndex={activeCommandIndex}
          onHover={setActiveCommandIndex}
          onSelect={selectCommand}
        />
        <textarea
          ref={textareaRef}
          aria-label="Prompt"
          placeholder={sendState.placeholder}
          value={prompt}
          disabled={!hasSession}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <button
        type="button"
        disabled={!sendState.canSend}
        onClick={sendState.isCancel ? onCancel : () => submitPrompt()}
      >
        {sendState.buttonLabel}
      </button>
    </footer>
  );
}
