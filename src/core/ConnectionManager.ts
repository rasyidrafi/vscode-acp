import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { Agent, InitializeResponse } from '@agentclientprotocol/sdk';
import type { Stream } from '@agentclientprotocol/sdk/dist/stream.js';
import { ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import { AcpClientImpl } from './AcpClientImpl';
import { FileSystemHandler } from '../handlers/FileSystemHandler';
import { TerminalHandler } from '../handlers/TerminalHandler';
import { PermissionHandler } from '../handlers/PermissionHandler';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { log, logError, logTraffic } from '../utils/Logger';
import { version as extensionVersion } from '../../package.json';

export interface ConnectionInfo {
  connection: ClientSideConnection;
  client: AcpClientImpl;
  initResponse: InitializeResponse;
  dispose(): void;
}

interface TappedStream {
  stream: Stream;
  dispose(): void;
}

/**
 * Manages ACP connections to agent processes.
 * Creates ClientSideConnection instances from spawned child processes.
 */
export class ConnectionManager {
  private connections: Map<string, ConnectionInfo> = new Map();

  constructor(
    private readonly sessionUpdateHandler: SessionUpdateHandler,
  ) {}

  /**
   * Create an ACP connection from a child process.
   * Sets up streams, creates connection, and performs initialization handshake.
   */
  async connect(agentId: string, process: ChildProcess): Promise<ConnectionInfo> {
    if (!process.stdout || !process.stdin) {
      throw new Error('Agent process missing stdio streams');
    }

    this.disposeConnection(agentId);

    log(`ConnectionManager: connecting to agent ${agentId}`);

    // Create Web Streams from Node.js streams
    const readable = Readable.toWeb(process.stdout) as ReadableStream<Uint8Array>;
    const writable = Writable.toWeb(process.stdin) as WritableStream<Uint8Array>;

    const stream = ndJsonStream(writable, readable);

    // Wrap the stream to intercept and log all ACP traffic
    const tappedStream = this.tapStream(stream);

    // Create handlers
    const fsHandler = new FileSystemHandler();
    const terminalHandler = new TerminalHandler();
    const permissionHandler = new PermissionHandler();

    // Create client implementation
    const client = new AcpClientImpl(
      fsHandler,
      terminalHandler,
      permissionHandler,
      this.sessionUpdateHandler,
    );

    // Create connection — toClient factory receives the Agent proxy
    const connection = new ClientSideConnection(
      (agent: Agent) => {
        client.setAgent(agent);
        return client;
      },
      tappedStream.stream,
    );

    // Initialize the connection
    log(`ConnectionManager: initializing connection to agent ${agentId}`);
    const initResponse = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: 'oacp',
        version: extensionVersion,
      },
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
        terminal: true,
      },
    });

    log(`ConnectionManager: initialized. Agent: ${initResponse.agentInfo?.name || 'unknown'} v${initResponse.agentInfo?.version || '?'}`);

    const info: ConnectionInfo = {
      connection,
      client,
      initResponse,
      dispose: () => {
        tappedStream.dispose();
        client.dispose();
      },
    };
    this.connections.set(agentId, info);
    void connection.closed.finally(() => {
      this.disposeConnection(agentId, info);
    });

    return info;
  }

  getConnection(agentId: string): ConnectionInfo | undefined {
    return this.connections.get(agentId);
  }

  removeConnection(agentId: string): void {
    this.disposeConnection(agentId);
  }

  dispose(): void {
    for (const agentId of Array.from(this.connections.keys())) {
      this.disposeConnection(agentId);
    }
  }

  disposeConnection(agentId: string, expectedInfo?: ConnectionInfo): void {
    const info = this.connections.get(agentId);
    if (!info || (expectedInfo && info !== expectedInfo)) {
      return;
    }

    this.connections.delete(agentId);

    try {
      info.dispose();
    } catch (e) {
      logError(`Failed to dispose connection for ${agentId}`, e);
    }
  }

  /**
   * Wrap a Stream to intercept and log all messages in both directions.
   */
  private tapStream(stream: Stream): TappedStream {
    // Tap outgoing messages (client → agent)
    const sendTap = new TransformStream({
      transform(chunk: unknown, controller: TransformStreamDefaultController) {
        logTraffic('send', chunk);
        controller.enqueue(chunk);
      },
    });

    // Tap incoming messages (agent → client)
    const recvTap = new TransformStream({
      transform(chunk: unknown, controller: TransformStreamDefaultController) {
        logTraffic('recv', chunk);
        controller.enqueue(chunk);
      },
    });

    const sendAbort = new AbortController();
    const recvAbort = new AbortController();

    // Pipe: sendTap.readable → original writable, original readable → recvTap.writable
    // These run in the background — no need to await
    void sendTap.readable
      .pipeTo(stream.writable, { signal: sendAbort.signal })
      .catch(e => {
        if (sendAbort.signal.aborted) {
          return;
        }
        logError('Traffic tap send pipe error', e);
      });
    void stream.readable
      .pipeTo(recvTap.writable, { signal: recvAbort.signal })
      .catch(e => {
        if (recvAbort.signal.aborted) {
          return;
        }
        logError('Traffic tap recv pipe error', e);
      });

    return {
      stream: {
        writable: sendTap.writable,
        readable: recvTap.readable,
      },
      dispose: () => {
        sendAbort.abort();
        recvAbort.abort();
      },
    };
  }
}
