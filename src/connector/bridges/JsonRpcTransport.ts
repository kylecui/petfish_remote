/**
 * Shared ndjson-over-stdio JSON-RPC 2.0 transport.
 * Used by both GeminiBridge (ACP) and CodexBridge (app-server).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import { EventEmitter } from 'node:events';

export interface JsonRpcRequest {
  jsonrpc?: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc?: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc?: '2.0';
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * Bidirectional JSON-RPC 2.0 transport over a child process's stdio.
 *
 * Emits:
 * - 'notification' (method: string, params: unknown)
 * - 'request' (id: number|string, method: string, params: unknown)
 * - 'close' (code: number|null)
 * - 'error' (err: Error)
 */
export class JsonRpcTransport extends EventEmitter {
  private proc: ChildProcess | undefined;
  private rl: readline.Interface | undefined;
  private idCounter = 0;
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private closed = false;

  constructor(opts?: { requestTimeoutMs?: number }) {
    super();
    this.requestTimeoutMs = opts?.requestTimeoutMs ?? 60_000;
  }

  /**
   * Spawn a child process and begin reading ndjson from stdout.
   */
  public spawn(bin: string, args: string[], env?: Record<string, string>): void {
    this.proc = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...env },
    });

    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on('line', (line) => this.handleLine(line));

    this.proc.on('close', (code) => {
      this.closed = true;
      this.rejectAll(new Error(`Process exited with code ${code}`));
      this.emit('close', code);
    });

    this.proc.on('error', (err) => {
      this.closed = true;
      this.rejectAll(err);
      this.emit('error', err);
    });
  }

  /**
   * Send a JSON-RPC request and await the response.
   */
  public request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Transport closed'));
    const id = ++this.idCounter;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`JSON-RPC request '${method}' timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  public notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.send({ jsonrpc: '2.0', method, params });
  }

  /**
   * Respond to a server-initiated request (approval/permission callback).
   */
  public respond(id: number | string, result: unknown): void {
    if (this.closed) return;
    this.send({ jsonrpc: '2.0', id, result });
  }

  /**
   * Respond with an error to a server-initiated request.
   */
  public respondError(id: number | string, code: number, message: string): void {
    if (this.closed) return;
    this.send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  /**
   * Kill the child process.
   */
  public kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.proc && !this.closed) {
      this.proc.kill(signal);
    }
  }

  public get isAlive(): boolean {
    return !this.closed;
  }

  private send(msg: object): void {
    if (!this.proc?.stdin?.writable) return;
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return; // Ignore malformed lines
    }

    // Response to our request
    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      const resp = msg as JsonRpcResponse;
      const p = this.pending.get(resp.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(resp.id);
        if (resp.error) {
          p.reject(new Error(`${resp.error.message} (code: ${resp.error.code})`));
        } else {
          p.resolve(resp.result);
        }
      }
      return;
    }

    // Server-initiated request (has id + method, no result/error)
    if ('id' in msg && 'method' in msg && !('result' in msg) && !('error' in msg)) {
      const req = msg as JsonRpcRequest;
      this.emit('request', req.id, req.method, req.params);
      return;
    }

    // Notification (has method, no id)
    if ('method' in msg && !('id' in msg)) {
      const notif = msg as JsonRpcNotification;
      this.emit('notification', notif.method, notif.params);
      return;
    }
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
