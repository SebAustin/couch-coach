export type ConnectionLevel = 'connected' | 'reconnecting' | 'lost';
export type ConnectionCard = 'none' | 'phone_lost' | 'service_lost';

/** The phone is "silent" after this long without a PoseBatch (docs/ux.md 2.3). */
export const PHONE_SILENT_MS = 5000;
/** The Couch Coach socket must be down this long before the "Lost connection" card replaces the pill alone. */
export const SERVICE_DOWN_MS = 5000;
/** After this long lost, offer New code / End session. */
export const RECOVERY_ACTIONS_MS = 30_000;

export interface ConnectionInput {
  /** State of the events WebSocket. */
  socket: 'connecting' | 'connected' | 'reconnecting' | 'closed';
  /** How long the socket has been not-connected (ms); 0 while connected. */
  socketDownMs: number;
  /** The phone has said hello. */
  hasPhone: boolean;
  /** The phone paused the Set (it may stop sending poses). */
  paused: boolean;
  /** Time since the last PoseBatch, or null if none yet. */
  msSincePose: number | null;
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
  const silent = input.hasPhone && !input.paused && input.msSincePose !== null && input.msSincePose > PHONE_SILENT_MS;
  if (silent) {
    return {
      level: 'lost',
      card: 'phone_lost',
      showRecoveryActions: (input.msSincePose ?? 0) >= RECOVERY_ACTIONS_MS,
    };
  }
  return { level: 'connected', card: 'none', showRecoveryActions: false };
}
