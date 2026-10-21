/** Minimal fake WebSocket that records what the client sends and lets tests play the server. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset(): void {
    FakeWebSocket.instances = [];
  }
  static get last(): FakeWebSocket {
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!ws) throw new Error('no socket was created');
    return ws;
  }

  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({});
  }

  // ---- test-side controls ----
  serverOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  serverSend(msg: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** Server (or network) drops the connection. */
  serverClose(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({});
  }
  /** Complete the handshake: open + connection_ack. */
  ack(connectionTimeoutMs = 300_000): void {
    this.serverOpen();
    this.serverSend({ type: 'connection_ack', connectionTimeoutMs });
  }
  sentOfType(type: string): Record<string, unknown>[] {
    return this.sent.filter((m) => m.type === type);
  }
}
