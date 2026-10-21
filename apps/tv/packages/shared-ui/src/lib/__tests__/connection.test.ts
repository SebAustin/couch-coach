import { deriveConnection, type ConnectionInput } from '../connection';

const base: ConnectionInput = { socket: 'connected', socketDownMs: 0, hasPhone: true, paused: false, msSincePose: 100 };

describe('deriveConnection', () => {
  it('is connected while poses keep arriving', () => {
    expect(deriveConnection(base)).toEqual({ level: 'connected', card: 'none', showRecoveryActions: false });
  });

  it('shows only the pill for a short socket blip, then the service card', () => {
    expect(deriveConnection({ ...base, socket: 'reconnecting', socketDownMs: 1000 })).toMatchObject({ level: 'reconnecting', card: 'none' });
    expect(deriveConnection({ ...base, socket: 'reconnecting', socketDownMs: 6000 })).toMatchObject({ card: 'service_lost' });
  });

  it('reports a lost phone after 5 s without poses and offers recovery after 30 s', () => {
    expect(deriveConnection({ ...base, msSincePose: 5001 })).toMatchObject({ level: 'lost', card: 'phone_lost', showRecoveryActions: false });
    expect(deriveConnection({ ...base, msSincePose: 31_000 })).toMatchObject({ showRecoveryActions: true });
  });

  it('does not call the phone lost when paused, before hello, or before any pose', () => {
    expect(deriveConnection({ ...base, paused: true, msSincePose: 9000 }).card).toBe('none');
    expect(deriveConnection({ ...base, hasPhone: false, msSincePose: 9000 }).card).toBe('none');
    expect(deriveConnection({ ...base, msSincePose: null }).card).toBe('none');
  });

  it('prefers the TV link problem over the phone problem', () => {
    expect(deriveConnection({ ...base, socket: 'reconnecting', socketDownMs: 9000, msSincePose: 9000 }).card).toBe('service_lost');
  });
});
