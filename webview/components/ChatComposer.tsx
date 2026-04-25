import { X, Plus, Square, ArrowUp } from 'lucide-react';
import type { AvailableCommand, SessionModeState } from '@agentclientprotocol/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';

import type { AttachedFile } from '../../src/shared/bridge';
import { searchCommands } from '../lib/commandSearch';
import type { RankedCommand } from '../lib/commandSearch';
import {
  commandInputHint,
  createBuiltInCommands,
  commandNeedsInput,
  commandPrompt,
  getComposerSendState,
  getLocalCommandMeta,
  getSlashCommandQuery,
} from './ChatComposer.logic';

export interface ComposerMenuState {
  commands: RankedCommand[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (command: AvailableCommand) => void;
}

interface ChatComposerProps {
  hasSession: boolean;
  turnInProgress: boolean;
  availableCommands: AvailableCommand[];
  modes: SessionModeState | null;
  attachedFiles: AttachedFile[];
  submitRequestNonce?: number;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onAttachFile: () => void;
  onRemoveAttachment: (path: string) => void;
  onModeChange: (modeId: string) => void;
  onCommandMenuChange?: (state: ComposerMenuState | null) => void;
}

export function ChatComposer({
  hasSession,
  turnInProgress,
  availableCommands,
  modes,
  attachedFiles,
  submitRequestNonce = 0,
  onSubmit,
  onCancel,
  onAttachFile,
  onRemoveAttachment,
  onModeChange,
  onCommandMenuChange,
}: ChatComposerProps): ReactElement {
  const [prompt, setPrompt] = useState('');
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [commandHint, setCommandHint] = useState<string | null>(null);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const lastSubmitRequestNonce = useRef(submitRequestNonce);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const builtInCommands = useMemo(() => createBuiltInCommands(modes), [modes]);
  const commandCatalog = useMemo(() => (
    [...builtInCommands, ...availableCommands.filter((command) => (
      builtInCommands.every((builtInCommand) => builtInCommand.name !== command.name)
    ))]
  ), [availableCommands, builtInCommands]);
  const slashQuery = getSlashCommandQuery(prompt);
  const commandResults = useMemo(() => (
    slashQuery === null ? [] : searchCommands(commandCatalog, slashQuery)
  ), [commandCatalog, slashQuery]);
  const menuOpen = slashQuery !== null &&
    slashQuery !== dismissedQuery &&
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

  const submitPrompt = useCallback((text = prompt): void => {
    const trimmed = text.trim();
    if (!hasSession || turnInProgress || (!trimmed && attachedFiles.length === 0)) {
      return;
    }
    onSubmit(trimmed || 'Please use the attached files as context.');
    setPrompt('');
    setCommandHint(null);
  }, [attachedFiles.length, hasSession, onSubmit, prompt, turnInProgress]);

  const selectCommand = useCallback((command: AvailableCommand): void => {
    const localCommand = getLocalCommandMeta(command);
    if (localCommand?.kind === 'set-mode') {
      onModeChange(localCommand.modeId);
      setPrompt('');
      setCommandHint(null);
      return;
    }

    const nextPrompt = commandPrompt(command);
    if (commandNeedsInput(command)) {
      setPrompt(`${nextPrompt} `);
      setCommandHint(commandInputHint(command));
      window.setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }

    submitPrompt(nextPrompt);
  }, [onModeChange, submitPrompt]);

  useEffect(() => {
    if (submitRequestNonce === lastSubmitRequestNonce.current) {
      return;
    }
    lastSubmitRequestNonce.current = submitRequestNonce;
    submitPrompt();
  }, [submitPrompt, submitRequestNonce]);

  useEffect(() => {
    if (!onCommandMenuChange) {
      return;
    }

    if (!menuOpen) {
      onCommandMenuChange(null);
      return;
    }

    onCommandMenuChange({
      commands: commandResults,
      activeIndex: activeCommandIndex,
      onHover: setActiveCommandIndex,
      onSelect: selectCommand,
    });
  }, [activeCommandIndex, commandResults, menuOpen, onCommandMenuChange, selectCommand]);

  useEffect(() => {
    return () => {
      onCommandMenuChange?.(null);
    };
  }, [onCommandMenuChange]);

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
