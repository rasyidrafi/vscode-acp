import { log } from '../utils/Logger';

import type { SessionNotification } from '@agentclientprotocol/sdk';
import {
  adaptSessionNotification,
  getSessionUpdateLabel,
  type BridgeSessionNotification,
} from '../shared/acpAdapters';

export type SessionUpdateListener = (update: BridgeSessionNotification) => void;

/**
 * Routes session/update notifications to registered listeners.
 * The ChatWebviewProvider registers as a listener to forward updates to the webview.
 */
export class SessionUpdateHandler {
  private listeners: Set<SessionUpdateListener> = new Set();

  addListener(listener: SessionUpdateListener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: SessionUpdateListener): void {
    this.listeners.delete(listener);
  }

  handleUpdate(update: SessionNotification): void {
    const normalized = adaptSessionNotification(update);
    log(`sessionUpdate: type=${getSessionUpdateLabel(normalized.update)}, sessionId=${normalized.sessionId}`);

    for (const listener of this.listeners) {
      try {
        listener(normalized);
      } catch (e) {
        log(`Error in session update listener: ${e}`);
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
