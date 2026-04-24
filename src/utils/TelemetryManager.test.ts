import { beforeEach, describe, expect, it, vi } from 'vitest';

const { telemetryReporterMock } = vi.hoisted(() => ({
  telemetryReporterMock: vi.fn(),
}));

vi.mock('vscode', () => ({
  env: {
    appName: 'VS Code',
    uriScheme: 'vscode',
    appHost: 'desktop',
    isTelemetryEnabled: true,
  },
}));

vi.mock('@vscode/extension-telemetry', () => ({
  TelemetryReporter: telemetryReporterMock,
}));

import * as vscode from 'vscode';
import {
  getTelemetryState,
  initTelemetry,
  resetTelemetryForTests,
} from './TelemetryManager';

describe('TelemetryManager', () => {
  beforeEach(() => {
    telemetryReporterMock.mockReset();
    telemetryReporterMock.mockImplementation(() => ({
      sendTelemetryEvent: vi.fn(),
      sendTelemetryErrorEvent: vi.fn(),
      dispose: vi.fn(),
    }));
    resetTelemetryForTests();
    (vscode.env as { isTelemetryEnabled: boolean }).isTelemetryEnabled = true;
  });

  it('stays disabled when VS Code telemetry is disabled', () => {
    (vscode.env as { isTelemetryEnabled: boolean }).isTelemetryEnabled = false;

    const reporter = initTelemetry();

    expect(reporter).toBeUndefined();
    expect(getTelemetryState()).toBe('disabled');
    expect(telemetryReporterMock).not.toHaveBeenCalled();
  });

  it('reports degraded state when reporter construction fails', () => {
    telemetryReporterMock.mockImplementation(() => {
      throw new Error('boom');
    });

    const reporter = initTelemetry();

    expect(reporter).toBeUndefined();
    expect(getTelemetryState()).toBe('degraded');
  });

  it('reports enabled state when reporter construction succeeds', () => {
    const reporter = initTelemetry();

    expect(reporter).toBeDefined();
    expect(getTelemetryState()).toBe('enabled');
  });
});
