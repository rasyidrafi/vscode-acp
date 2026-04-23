import type { SessionModeState, SessionModelState } from '@agentclientprotocol/sdk';
import type { ReactElement } from 'react';

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
}: SessionBannerProps): ReactElement {
  const view = getSessionBannerView(session, modes, models);

  return (
    <section className="session-strip" aria-live="polite">
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
              label="Mode"
              value={view.mode.currentId}
              title={view.mode.currentLabel}
              options={view.mode.options}
              onChange={onModeChange}
            />
          ) : null}
          {view.model ? (
            <SessionSelect
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
  label,
  value,
  title,
  options,
  onChange,
}: {
  label: string;
  value: string;
  title: string;
  options: SessionPickerOption[];
  onChange: (id: string) => void;
}): ReactElement {
  return (
    <label className="session-select" title={title}>
      <span>{label}</span>
      <select
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id} title={option.description}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
