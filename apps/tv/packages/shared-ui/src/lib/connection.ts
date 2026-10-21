export type ConnectionLevel = 'connected' | 'reconnecting' | 'lost';
export type ConnectionCard = 'none' | 'phone_lost' | 'service_lost';

/**
 * The phone is "silent" after this long without ANY signal (presence, pose or event). The phone sends presence
 * about every 2 s even with nobody in frame, so silence means the phone is gone, not that you stepped away.
 */
export const PHONE_SILENT_MS = 10000;
/** Once the phone has been lost this long, ask the events client to reconnect (and again every interval). */
export const RECONNECT_AFTER_MS = 10_000;
/** The Couch Coach socket must be down this long before the "Lost connection" card replaces the pill alone. */
export const SERVICE_DOWN_MS = 5000;
/** After this long lost, offer New code / End session. */
export const RECOVERY_ACTIONS_MS = 30_000;

export interface ConnectionInput {
  /** State of the events WebSocket. */
  socket: 'connecting' | 'connected' | 'reconnecting' | 'closed';
  /** How long the socket has been not-connected (ms); 0 while connected. */
  socketDownMs: number;
  /** A phone has joined (hello, or any phone event or pose). */
  hasPhone: boolean;
  /** The phone paused the Set (it may stop sending). */
  paused: boolean;
  /** Time since the last phone signal (presence, PoseBatch or any phone event), or null if none yet. */
  msSinceSignal: number | null;
}

export interface ConnectionView {
  level: ConnectionLevel;
  card: ConnectionCard;
  showRecoveryActions: boolean;
}

/** Pure mapping from link health to what the Live screen shows. The TV's own link outranks the phone's. */
export function deriveConnection(input: ConnectionInput): ConnectionView {
  if (input.socket !== 'connected') {
    const sustained = input.socketDownMs >= SERVICE_DOWN_MS;
    return {
      level: 'reconnecting',
      card: sustained ? 'service_lost' : 'none',
      showRecoveryActions: input.socketDownMs >= RECOVERY_ACTIONS_MS,
    };
  }
  const silent = input.hasPhone && !input.paused && input.msSinceSignal !== null && input.msSinceSignal > PHONE_SILENT_MS;
  if (silent) {
    return {
      level: 'lost',
      card: 'phone_lost',
      showRecoveryActions: (input.msSinceSignal ?? 0) >= RECOVERY_ACTIONS_MS,
    };
  }
  return { level: 'connected', card: 'none', showRecoveryActions: false };
}

/**
 * 0 until the phone has been lost for more than RECONNECT_AFTER_MS, then 1, 2, ... for each further interval.
 * A change in this number is the cue to call `reconnect()` once.
 */
export function reconnectTick(card: ConnectionCard, msSinceSignal: number | null): number {
  if (card !== 'phone_lost' || msSinceSignal === null || msSinceSignal <= RECONNECT_AFTER_MS) return 0;
  return Math.floor(msSinceSignal / RECONNECT_AFTER_MS);
}
