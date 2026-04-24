import { X, Plus, Square, ArrowUp } from 'lucide-react';
import type { AvailableCommand } from '@agentclientprotocol/sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';

import type { AttachedFile } from '../../src/shared/bridge';
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
  attachedFiles: AttachedFile[];
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onAttachFile: () => void;
  onRemoveAttachment: (path: string) => void;
}

export function ChatComposer({
  hasSession,
  turnInProgress,
  availableCommands,
  attachedFiles,
  onSubmit,
  onCancel,
  onAttachFile,
  onRemoveAttachment,
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
    attachmentCount: attachedFiles.length,
    commandInputHint: commandHint,
  });

  useEffect(() => {
    setActiveCommandIndex(0);
    setDismissedQuery(null);
  }, [slashQuery]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 170)}px`;
    }
  }, [prompt]);

  useEffect(() => {
    if (!prompt.startsWith('/')) {
      setCommandHint(null);
    }
  }, [prompt]);

  function submitPrompt(text = prompt): void {
    const trimmed = text.trim();
    if (!hasSession || turnInProgress || (!trimmed && attachedFiles.length === 0)) {
      return;
    }
    onSubmit(trimmed || 'Please use the attached files as context.');
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
      <div className="composer-card">
        <ComposerCommandMenu
          commands={menuOpen ? commandResults : []}
          activeIndex={activeCommandIndex}
          onHover={setActiveCommandIndex}
          onSelect={selectCommand}
        />
        {attachedFiles.length > 0 ? (
          <div className="attachment-strip" aria-label="Attached files">
            {attachedFiles.map((file) => (
              <span key={file.path} className="attachment-chip" title={file.path}>
                <span className="attachment-name">{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => onRemoveAttachment(file.path)}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          data-chat-input="true"
          aria-label="Prompt"
          placeholder={sendState.placeholder}
          value={prompt}
          disabled={!hasSession}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <div className="composer-footer" data-chat-input-footer="true">
          <div className="composer-tools">
            <button
              type="button"
              className="composer-tool-button composer-icon-button"
              disabled={!hasSession || turnInProgress}
              aria-label="Attach file"
              title="Attach file"
              onClick={onAttachFile}
            >
              <Plus size={16} />
            </button>
            {availableCommands.length > 0 ? <span className="composer-hint">/ commands</span> : null}
          </div>
          <button
            type="button"
            className={sendState.isCancel ? 'composer-send-button cancel' : 'composer-send-button'}
            disabled={!sendState.canSend}
            onClick={sendState.isCancel ? onCancel : () => submitPrompt()}
            aria-label={sendState.isCancel ? 'Stop response' : 'Send prompt'}
            title={sendState.isCancel ? 'Stop' : 'Send'}
          >
            {sendState.isCancel ? (
              <Square size={14} />
            ) : (
              <ArrowUp size={14} />
            )}
          </button>
        </div>
      </div>
    </footer>
  );
}
