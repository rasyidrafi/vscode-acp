import type { SessionModeState, SessionModelState } from '@agentclientprotocol/sdk';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import type { BridgeSessionState } from '../../src/shared/bridge';
import { getSessionBannerView, type SessionPickerOption } from './SessionBanner.logic';

interface SessionBannerProps {
  session: BridgeSessionState | null;
  modes: SessionModeState | null;
  models: SessionModelState | null;
  onModeChange: (modeId: string) => void;
  onModelChange: (modelId: string) => void;
}

export function SessionBanner({
  session,
  modes,
  models,
  onModeChange,
  onModelChange,
}: SessionBannerProps): ReactElement | null {
  if (!session) {
    return null;
  }

  const view = getSessionBannerView(session, modes, models);

  return (
    <section className="session-strip" aria-label="Connected agent" aria-live="polite">
      <div className="session-main">
        <span className={view.connected ? 'status-dot connected' : 'status-dot'} />
        <div className="session-copy">
          <strong>{view.agentName}</strong>
          <span title={view.cwd}>{view.cwd}</span>
        </div>
      </div>

      {view.mode || view.model ? (
        <div className="session-controls" aria-label="Session controls">
          {view.mode ? (
            <SessionSelect
              kind="mode"
              label="Mode"
              value={view.mode.currentId}
              title={view.mode.currentLabel}
              options={view.mode.options}
              onChange={onModeChange}
            />
          ) : null}
          {view.model ? (
            <SessionSelect
              kind="model"
              label="Model"
              value={view.model.currentId}
              title={view.model.currentLabel}
              options={view.model.options}
              onChange={onModelChange}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SessionSelect({
  kind,
  label,
  value,
  title,
  options,
  onChange,
}: {
  kind: 'mode' | 'model';
  label: string;
  value: string;
  title: string;
  options: SessionPickerOption[];
  onChange: (id: string) => void;
}): ReactElement {
  const currentOption = options.find((o) => o.id === value);
  const [isOpen, setIsOpen] = useState(false);
  const [menuReady, setMenuReady] = useState(false);
  const [menuDirection, setMenuDirection] = useState<'up' | 'down'>('down');
  const [menuOffsetX, setMenuOffsetX] = useState(0);
  const [menuMaxHeight, setMenuMaxHeight] = useState(280);
  const [menuMinWidth, setMenuMinWidth] = useState(180);
  const [menuMaxWidth, setMenuMaxWidth] = useState(420);
  const selectRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!selectRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const updateMenuPosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) {
        return;
      }

      const viewportPadding = 8;
      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      setMenuMinWidth(Math.max(180, Math.floor(triggerRect.width)));
      setMenuMaxWidth(Math.max(220, Math.floor(window.innerWidth - (viewportPadding * 2))));
      const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
      const spaceAbove = triggerRect.top - viewportPadding;
      const shouldOpenUp = menuRect.height > spaceBelow && spaceAbove > spaceBelow;
      setMenuDirection(shouldOpenUp ? 'up' : 'down');
      setMenuMaxHeight(Math.max(120, Math.floor(shouldOpenUp ? spaceAbove : spaceBelow)));

      let nextOffsetX = 0;
      if (menuRect.right > window.innerWidth - viewportPadding) {
        nextOffsetX -= menuRect.right - (window.innerWidth - viewportPadding);
      }
      if (menuRect.left < viewportPadding) {
        nextOffsetX += viewportPadding - menuRect.left;
      }
      setMenuOffsetX(nextOffsetX);
      setMenuReady(true);
    };

    setMenuReady(false);
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen]);

  const menuStyle: CSSProperties = {
    visibility: menuReady ? 'visible' : 'hidden',
    transform: menuOffsetX === 0 ? undefined : `translateX(${menuOffsetX}px)`,
    maxHeight: `${menuMaxHeight}px`,
    minWidth: `${Math.max(180, menuMinWidth)}px`,
    maxWidth: `${menuMaxWidth}px`,
  };

  return (
    <div
      ref={selectRef}
      className={`session-select ${kind}`}
      title={title}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setIsOpen(false);
        }
      }}
    >
      <span className="select-label">{label}:</span>
      <button
        type="button"
        className="select-trigger"
        ref={triggerRef}
        aria-label={`${label}: ${currentOption?.label || value}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        onClick={() => {
          setIsOpen((open) => {
            if (!open) {
              setMenuReady(false);
              setMenuOffsetX(0);
            }
            return !open;
          });
        }}
      >
        <span className="select-value">{currentOption?.label || value}</span>
        <i className="codicon codicon-chevron-down select-chevron" style={{ fontSize: '12px' }}></i>
      </button>
      {isOpen ? (
        <div
          id={listId}
          ref={menuRef}
          className={`select-menu ${menuDirection === 'up' ? 'up' : ''}`}
          role="listbox"
          aria-label={`${label} options`}
          style={menuStyle}
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              className={option.id === value ? 'select-option active' : 'select-option'}
              aria-selected={option.id === value}
              title={option.description}
              onClick={() => {
                setIsOpen(false);
                if (option.id !== value) {
                  onChange(option.id);
                }
              }}
            >
              {kind === 'mode' ? (
                <span className="select-option-icon" aria-hidden="true">
                  {(() => {
                    const OptionIcon = getModeOptionIcon(option.label, option.id);
                    return OptionIcon ? <OptionIcon /> : null;
                  })()}
                </span>
              ) : null}
              <span className="select-option-copy">
                <span>{option.label}</span>
                {option.description ? <small>{option.description}</small> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getModeOptionIcon(label: string, id: string): (() => ReactElement) | null {
  const key = `${id} ${label}`.toLowerCase();
  if (key.includes('auto')) {
    return PencilIcon;
  }
  if (key.includes('full') || key.includes('yolo')) {
    return UnlockIcon;
  }
  if (key.includes('plan')) {
    return null;
  }
  return LockIcon;
}

function LockIcon(): ReactElement {
  return <i className="codicon codicon-lock" style={{ fontSize: '14px' }}></i>;
}

function UnlockIcon(): ReactElement {
  return <i className="codicon codicon-unlock" style={{ fontSize: '14px' }}></i>;
}

function PencilIcon(): ReactElement {
  return <i className="codicon codicon-edit" style={{ fontSize: '14px' }}></i>;
}
