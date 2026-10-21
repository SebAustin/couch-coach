import { backoffDelay } from './backoff';
import { base64UrlEncode } from './base64url';
import type {
  EventsClient,
  EventsClientOptions,
  EventsStatus,
  WebSocketConstructor,
  WebSocketLike,
} from './types';

/** AppSync Events accepts at most 5 events per publish. */
const MAX_EVENTS_PER_PUBLISH = 5;
const DEFAULT_PUBLISH_TIMEOUT_MS = 10_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 8_000;
const DEFAULT_BACKOFF_BASE_MS = 250;
const DEFAULT_BACKOFF_MAX_MS = 5_000;
const DEFAULT_MAX_QUEUE = 60;
const DEFAULT_MAX_KEEP_ALIVE_MS = 120_000;
const DEFAULT_EPHEMERAL_MAX_AGE_MS = 1_000;
/** A publish whose ack times out is resent on a fresh connection this many times in total. */
const MAX_PUBLISH_ATTEMPTS = 3;
/** AppSync's documented default when `connection_ack` carries no timeout. */
const FALLBACK_CONNECTION_TIMEOUT_MS = 300_000;

interface Subscription {
  id: string;
  channel: string;
  listeners: Set<(event: unknown) => void>;
  /** Consecutive failed subscribe attempts (error or no ack); drives the retry backoff. */
  retries: number;
  ackTimer?: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
}

interface Publish {
  id: string;
  channel: string;
  events: string[];
  ephemeral: boolean;
  queuedAt: number;
  attempts: number;
  resolve: () => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

let idCounter = 0;
/** Unique-enough id without `crypto` (not available on every React Native engine). */
function newId(): string {
  idCounter += 1;
  return `cc-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function describeErrors(msg: Record<string, unknown>): string {
  const errors = msg.errors;
  if (!Array.isArray(errors) || errors.length === 0) return String(msg.type);
  return errors
    .map((e: { errorType?: string; message?: string }) => `${e.errorType ?? 'Error'}: ${e.message ?? ''}`.trim())
    .join('; ');
}

/**
 * Raw AppSync Events WebSocket client. No Amplify, no Node-only APIs: runs in
 * browsers and React Native. Connects immediately, reconnects forever with
 * jittered backoff, resubscribes, and never throws: problems go to `onStatus`.
 */
export function createEventsClient(options: EventsClientOptions): EventsClient {
  const WebSocketImpl: WebSocketConstructor | undefined =
    options.WebSocketImpl ?? (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!WebSocketImpl) throw new Error('No WebSocket implementation available; pass WebSocketImpl');
  const WS: WebSocketConstructor = WebSocketImpl;

  const publishTimeoutMs = options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const backoffMaxMs = options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
  const maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
  const maxKeepAliveMs = options.maxKeepAliveMs ?? DEFAULT_MAX_KEEP_ALIVE_MS;
  const ephemeralMaxAgeMs = options.ephemeralMaxAgeMs ?? DEFAULT_EPHEMERAL_MAX_AGE_MS;
  const isEphemeral = options.isEphemeral ?? ((channel: string) => channel.endsWith('/pose'));
  const random = options.random ?? Math.random;

  const authorization = { host: options.httpHost, 'x-api-key': options.apiKey };
  const url = `wss://${options.realtimeHost}/event/realtime`;
  const protocols = ['aws-appsync-event-ws', `header-${base64UrlEncode(JSON.stringify(authorization))}`];

  let socket: WebSocketLike | null = null;
  let isClosed = false;
  let status: EventsStatus = { state: 'connecting', attempt: 0 };
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let keepAliveTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let connectionTimeoutMs = FALLBACK_CONNECTION_TIMEOUT_MS;

  const statusListeners = new Set<(s: EventsStatus) => void>();
  const subscriptions = new Map<string, Subscription>();
  /** Publishes not yet sent, oldest first. */
  let queue: Publish[] = [];
  /** Publishes sent and waiting for publish_success, in send order. */
  const inflight = new Map<string, Publish>();

  const isConnected = () => status.state === 'connected';

  function setStatus(patch: Partial<EventsStatus>): void {
    status = { ...status, error: undefined, ...patch };
    for (const cb of [...statusListeners]) cb(status);
  }

  function reportError(error: string): void {
    setStatus({ error });
  }

  function sendRaw(msg: Record<string, unknown>): void {
    try {
      socket?.send(JSON.stringify(msg));
    } catch (err) {
      reportError(`send failed: ${(err as Error).message}`);
    }
  }

  // ---- publish queue -------------------------------------------------------

  function dropOldest(): void {
    const ephemeralIndex = queue.findIndex((p) => p.ephemeral);
    const [dropped] = queue.splice(ephemeralIndex >= 0 ? ephemeralIndex : 0, 1);
    dropped?.reject(new Error('dropped: publish queue full while disconnected'));
  }

  function enforceQueueBound(): void {
    while (queue.length > maxQueue) dropOldest();
  }

  function sendPublish(p: Publish): void {
    const ws = socket;
    p.attempts += 1;
    inflight.set(p.id, p);
    sendRaw({ type: 'publish', id: p.id, channel: p.channel, events: p.events, authorization });
    p.timer = setTimeout(() => {
      if (!inflight.has(p.id)) return;
      // No ack: the socket is probably dead even though the browser has not noticed. Drop it so
      // recoverInflight() requeues (or rejects, if ephemeral) everything that was in flight.
      if (p.attempts >= MAX_PUBLISH_ATTEMPTS) {
        inflight.delete(p.id);
        p.reject(new Error(`publish timed out after ${publishTimeoutMs} ms`));
      }
      if (ws) dropConnection(ws, 'publish timed out');
    }, publishTimeoutMs);
  }

  function flushQueue(): void {
    const pending = queue;
    queue = [];
    const now = Date.now();
    for (const p of pending) {
      if (p.ephemeral && now - p.queuedAt > ephemeralMaxAgeMs) p.reject(new Error('dropped: stale pose batch'));
      else sendPublish(p);
    }
  }

  /** After a drop: ephemeral publishes are rejected, the rest go back to the front of the queue. */
  function recoverInflight(): void {
    const requeue: Publish[] = [];
    for (const p of inflight.values()) {
      clearTimeout(p.timer);
      if (p.ephemeral) p.reject(new Error('connection lost before publish was acknowledged'));
      else requeue.push(p);
    }
    inflight.clear();
    queue = [...requeue, ...queue];
    enforceQueueBound();
  }

  // ---- incoming messages ---------------------------------------------------

  function handleData(msg: Record<string, unknown>): void {
    const sub = [...subscriptions.values()].find((s) => s.id === msg.id);
    if (!sub || typeof msg.event !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(msg.event);
    } catch {
      reportError(`malformed event on ${sub.channel}`);
      return;
    }
    for (const listener of [...sub.listeners]) {
      try {
        listener(parsed);
      } catch (err) {
        reportError(`listener error on ${sub.channel}: ${(err as Error).message}`);
      }
    }
  }

  function handlePublishResult(msg: Record<string, unknown>): void {
    const p = inflight.get(String(msg.id));
    if (!p) return;
    inflight.delete(p.id);
    clearTimeout(p.timer);
    if (msg.type === 'publish_error') p.reject(new Error(describeErrors(msg)));
    else if (Array.isArray(msg.failed) && msg.failed.length > 0) {
      p.reject(new Error(`${msg.failed.length} event(s) failed to publish`));
    } else p.resolve();
  }

  function armKeepAlive(ws: WebSocketLike): void {
    clearTimeout(keepAliveTimer);
    keepAliveTimer = setTimeout(
      () => dropConnection(ws, 'keep-alive timeout'),
      Math.min(connectionTimeoutMs, maxKeepAliveMs),
    );
  }

  function handleAck(ws: WebSocketLike, msg: Record<string, unknown>): void {
    clearTimeout(handshakeTimer);
    connectionTimeoutMs =
      typeof msg.connectionTimeoutMs === 'number' && msg.connectionTimeoutMs > 0
        ? msg.connectionTimeoutMs
        : FALLBACK_CONNECTION_TIMEOUT_MS;
    armKeepAlive(ws);
    setStatus({ state: 'connected', attempt: 0 });
    for (const sub of subscriptions.values()) {
      sub.retries = 0;
      sendSubscribe(sub);
    }
    flushQueue();
  }

  function onMessage(ws: WebSocketLike, raw: unknown): void {
    if (isConnected()) armKeepAlive(ws); // any traffic proves the link is alive
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      reportError('malformed message from server');
      return;
    }
    switch (msg.type) {
      case 'connection_ack':
        handleAck(ws, msg);
        break;
      case 'data':
        handleData(msg);
        break;
      case 'publish_success':
      case 'publish_error':
        handlePublishResult(msg);
        break;
      case 'subscribe_success':
        handleSubscribeSuccess(msg);
        break;
      case 'subscribe_error':
        reportError(describeErrors(msg));
        handleSubscribeError(ws, msg);
        break;
      case 'error':
        reportError(describeErrors(msg));
        break;
      default: // ka, unsubscribe_success
        break;
    }
  }

  const findSubscription = (id: unknown) => [...subscriptions.values()].find((s) => s.id === id);

  function clearSubscriptionTimers(sub: Subscription): void {
    clearTimeout(sub.ackTimer);
    clearTimeout(sub.retryTimer);
  }

  /** Send `subscribe` and expect `subscribe_success`; no ack in time counts as a failed attempt. */
  function sendSubscribe(sub: Subscription): void {
    const ws = socket;
    clearSubscriptionTimers(sub);
    sendRaw({ type: 'subscribe', id: sub.id, channel: sub.channel, authorization });
    sub.ackTimer = setTimeout(() => retrySubscribe(sub, ws), publishTimeoutMs);
  }

  function retrySubscribe(sub: Subscription, ws: WebSocketLike | null): void {
    clearSubscriptionTimers(sub);
    if (!ws || ws !== socket || !isConnected()) return; // a reconnect resubscribes everything
    const delay = backoffDelay(sub.retries, backoffBaseMs, backoffMaxMs, random);
    sub.retries += 1;
    sub.retryTimer = setTimeout(() => {
      if (subscriptions.get(sub.channel) === sub && ws === socket && isConnected()) sendSubscribe(sub);
    }, delay);
  }

  function handleSubscribeSuccess(msg: Record<string, unknown>): void {
    const sub = findSubscription(msg.id);
    if (!sub) return;
    clearSubscriptionTimers(sub);
    sub.retries = 0;
  }

  function handleSubscribeError(ws: WebSocketLike, msg: Record<string, unknown>): void {
    const sub = findSubscription(msg.id);
    if (sub) retrySubscribe(sub, ws);
  }

  // ---- connection lifecycle ------------------------------------------------

  function detach(ws: WebSocketLike): void {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  /** Tear down `ws` (if it is still the current socket) and schedule a reconnect. */
  function dropConnection(ws: WebSocketLike, reason: string): void {
    if (ws !== socket || isClosed) return;
    detach(ws);
    socket = null;
    clearTimeout(handshakeTimer);
    clearTimeout(keepAliveTimer);
    recoverInflight();
    const attempt = status.attempt + 1;
    setStatus({ state: 'reconnecting', attempt, error: reason });
    reconnectTimer = setTimeout(connect, backoffDelay(attempt - 1, backoffBaseMs, backoffMaxMs, random));
  }

  function connect(): void {
    if (isClosed) return;
    let ws: WebSocketLike;
    try {
      ws = new WS(url, protocols);
    } catch (err) {
      reportError(`cannot open WebSocket: ${(err as Error).message}`);
      reconnectTimer = setTimeout(connect, backoffDelay(status.attempt, backoffBaseMs, backoffMaxMs, random));
      setStatus({ attempt: status.attempt + 1, error: status.error });
      return;
    }
    socket = ws;
    ws.onopen = () => sendRaw({ type: 'connection_init' });
    ws.onmessage = (ev) => onMessage(ws, ev.data);
    ws.onerror = (ev) => {
      const detail = (ev as { message?: unknown } | null)?.message;
      reportError(`socket error${typeof detail === 'string' ? `: ${detail}` : ''}`);
    };
    ws.onclose = () => dropConnection(ws, 'socket closed');
    handshakeTimer = setTimeout(() => dropConnection(ws, 'handshake timeout'), handshakeTimeoutMs);
  }

  function shutDown(): void {
    isClosed = true;
    clearTimeout(handshakeTimer);
    clearTimeout(keepAliveTimer);
    clearTimeout(reconnectTimer);
    if (socket) detach(socket);
    socket = null;
    const closedError = () => new Error('client closed');
    for (const p of inflight.values()) {
      clearTimeout(p.timer);
      p.reject(closedError());
    }
    inflight.clear();
    for (const p of queue) p.reject(closedError());
    queue = [];
    for (const sub of subscriptions.values()) clearSubscriptionTimers(sub);
    subscriptions.clear();
    setStatus({ state: 'closed' });
  }

  connect();

  return {
    subscribe(channel, onEvent) {
      if (isClosed) return () => {};
      let sub = subscriptions.get(channel);
      if (!sub) {
        sub = { id: newId(), channel, listeners: new Set(), retries: 0 };
        subscriptions.set(channel, sub);
        if (isConnected()) sendSubscribe(sub);
      }
      sub.listeners.add(onEvent);
      const current = sub;
      return () => {
        current.listeners.delete(onEvent);
        if (current.listeners.size > 0 || subscriptions.get(channel) !== current) return;
        subscriptions.delete(channel);
        clearSubscriptionTimers(current);
        if (isConnected()) sendRaw({ type: 'unsubscribe', id: current.id });
      };
    },

    publish(channel, events, publishOptions) {
      if (isClosed) return Promise.reject(new Error('client closed'));
      if (events.length === 0 || events.length > MAX_EVENTS_PER_PUBLISH) {
        return Promise.reject(new Error(`publish takes 1-${MAX_EVENTS_PER_PUBLISH} events, got ${events.length}`));
      }
      return new Promise<void>((resolve, reject) => {
        const p: Publish = {
          id: newId(),
          channel,
          events: events.map((e) => JSON.stringify(e)),
          ephemeral: publishOptions?.ephemeral ?? isEphemeral(channel),
          queuedAt: Date.now(),
          attempts: 0,
          resolve,
          reject,
        };
        queue.push(p);
        if (isConnected()) flushQueue();
        else enforceQueueBound();
      });
    },

    onStatus(cb) {
      statusListeners.add(cb);
      cb(status);
      return () => statusListeners.delete(cb);
    },

    reconnect() {
      if (isClosed) return;
      clearTimeout(reconnectTimer);
      clearTimeout(handshakeTimer);
      clearTimeout(keepAliveTimer);
      if (socket) detach(socket);
      socket = null;
      recoverInflight();
      setStatus({ state: 'reconnecting', attempt: 0 });
      connect();
    },

    close() {
      if (!isClosed) shutDown();
    },
  };
}
