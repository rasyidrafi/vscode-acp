import type { SessionModeState, SessionModelState } from '@agentclientprotocol/sdk';

import type { BridgeSessionState } from '../../src/shared/bridge';

export interface SessionPickerOption {
  id: string;
  label: string;
  description?: string;
}

export interface SessionBannerView {
  connected: boolean;
  agentName: string;
  cwd: string;
  mode: {
    currentId: string;
    currentLabel: string;
    options: SessionPickerOption[];
  } | null;
  model: {
    currentId: string;
    currentLabel: string;
    options: SessionPickerOption[];
  } | null;
}

export function getSessionBannerView(
  session: BridgeSessionState | null,
  modes: SessionModeState | null,
  models: SessionModelState | null,
): SessionBannerView {
  return {
    connected: Boolean(session),
    agentName: session?.agentName ?? 'No active agent',
    cwd: session?.cwd ?? 'Connect to an agent to start chatting.',
    mode: normalizeModePicker(modes),
    model: normalizeModelPicker(models),
  };
}

function normalizeModePicker(modes: SessionModeState | null): SessionBannerView['mode'] {
  if (!modes || modes.availableModes.length === 0) {
    return null;
  }

  const options = modes.availableModes.map((mode) => ({
    id: mode.id,
    label: mode.name,
    description: mode.description ?? undefined,
  }));
  const current = options.find((option) => option.id === modes.currentModeId);

  return {
    currentId: modes.currentModeId,
    currentLabel: current?.label ?? 'Mode',
    options,
  };
}

function normalizeModelPicker(models: SessionModelState | null): SessionBannerView['model'] {
  if (!models || models.availableModels.length === 0) {
    return null;
  }

  const options = models.availableModels.map((model) => ({
    id: model.modelId,
    label: model.name,
    description: model.description ?? undefined,
  }));
  const current = options.find((option) => option.id === models.currentModelId);

  return {
    currentId: models.currentModelId,
    currentLabel: current?.label ?? 'Model',
    options,
  };
}
