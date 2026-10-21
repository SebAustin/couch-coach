import { deriveConnection, reconnectTick, PHONE_SILENT_MS, RECONNECT_AFTER_MS, type ConnectionInput } from '../connection';

const base: ConnectionInput = { socket: 'connected', socketDownMs: 0, hasPhone: true, paused: false, msSinceSignal: 100 };

describe('deriveConnection', () => {
  it('is connected while any phone signal keeps arriving', () => {
    expect(deriveConnection(base)).toEqual({ level: 'connected', card: 'none', showRecoveryActions: false });
  });

  it('shows only the pill for a short socket blip, then the service card', () => {
    expect(deriveConnection({ ...base, socket: 'reconnecting', socketDownMs: 1000 })).toMatchObject({ level: 'reconnecting', card: 'none' });
    expect(deriveConnection({ ...base, socket: 'reconnecting', socketDownMs: 6000 })).toMatchObject({ card: 'service_lost' });
  });

  it('reports a lost phone only after more than 10 s without any signal, and offers recovery after 30 s', () => {
    expect(PHONE_SILENT_MS).toBe(10000);
    expect(deriveConnection({ ...base, msSinceSignal: 10000 }).card).toBe('none');
    expect(deriveConnection({ ...base, msSinceSignal: 10001 })).toMatchObject({ level: 'lost', card: 'phone_lost', showRecoveryActions: false });
    expect(deriveConnection({ ...base, msSinceSignal: 31_000 })).toMatchObject({ showRecoveryActions: true });
  });

  it('does not call the phone lost when paused, before hello, or before any signal', () => {
    expect(deriveConnection({ ...base, paused: true, msSinceSignal: 9000 }).card).toBe('none');
    expect(deriveConnection({ ...base, hasPhone: false, msSinceSignal: 9000 }).card).toBe('none');
    expect(deriveConnection({ ...base, msSinceSignal: null }).card).toBe('none');
  });

  it('prefers the TV link problem over the phone problem', () => {
    expect(deriveConnection({ ...base, socket: 'reconnecting', socketDownMs: 9000, msSinceSignal: 9000 }).card).toBe('service_lost');
  });
});

describe('reconnectTick', () => {
  it('is 0 until the phone has been lost for more than 10 s, then counts each further 10 s', () => {
    expect(RECONNECT_AFTER_MS).toBe(10_000);
    expect(reconnectTick('none', 20_000)).toBe(0);
    expect(reconnectTick('phone_lost', 9_999)).toBe(0);
    expect(reconnectTick('phone_lost', 10_001)).toBe(1);
    expect(reconnectTick('phone_lost', 19_000)).toBe(1);
    expect(reconnectTick('phone_lost', 20_500)).toBe(2);
    expect(reconnectTick('phone_lost', null)).toBe(0);
  });
});
