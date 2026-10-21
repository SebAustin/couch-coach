import { ApiError, createApi, pairingUrl, shortUrlHint } from '../client';

const respond = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const sessionBody = {
  sessionId: 'a'.repeat(32),
  phoneToken: 'tok',
  phoneUrl: 'https://phone.example.com/?s=' + 'a'.repeat(32) + '&t=tok',
  expiresAt: 123,
  memberId: 'm1',
};

describe('createApi', () => {
  it('GETs members and validates the envelope', async () => {
    const fetchMock = jest.fn().mockResolvedValue(respond({ members: [{ memberId: 'm1', name: 'Maya', lastSeenAt: 5 }] }));
    const api = createApi({ apiBaseUrl: 'https://api.example.com/' }, fetchMock);
    await expect(api.getMembers()).resolves.toEqual([{ memberId: 'm1', name: 'Maya', lastSeenAt: 5 }]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/members');
  });

  it('POSTs a trimmed name to create a Member', async () => {
    const fetchMock = jest.fn().mockResolvedValue(respond({ memberId: 'm2', name: 'Jon' }, 201));
    const api = createApi({ apiBaseUrl: 'https://api.example.com' }, fetchMock);
    await api.createMember('  Jon ');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Jon' });
  });

  it('POSTs the memberId to create a Session and parses the response', async () => {
    const fetchMock = jest.fn().mockResolvedValue(respond(sessionBody, 201));
    const api = createApi({ apiBaseUrl: 'https://api.example.com' }, fetchMock);
    const session = await api.createSession('m1');
    expect(session.sessionId).toBe('a'.repeat(32));
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ memberId: 'm1' });
  });

  it('reports HTTP failures with the status', async () => {
    const api = createApi({ apiBaseUrl: 'https://x.test' }, jest.fn().mockResolvedValue(respond({}, 429)));
    await expect(api.createSession('m1')).rejects.toMatchObject({ kind: 'http', status: 429 });
  });

  it('reports contract violations as schema errors', async () => {
    const api = createApi({ apiBaseUrl: 'https://x.test' }, jest.fn().mockResolvedValue(respond({ members: [{ nope: 1 }] })));
    await expect(api.getMembers()).rejects.toMatchObject({ kind: 'schema' });
  });

  it('reports network failures and timeouts as network errors', async () => {
    const api = createApi({ apiBaseUrl: 'https://x.test' }, jest.fn().mockRejectedValue(new TypeError('boom')));
    await expect(api.getMembers()).rejects.toBeInstanceOf(ApiError);
    await expect(api.getMembers()).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('pairing helpers', () => {
  it('appends the Member id to the phone URL', () => {
    expect(pairingUrl('https://p.example.com/?s=1&t=2', 'm 1')).toBe('https://p.example.com/?s=1&t=2&m=m%201');
    expect(pairingUrl('https://p.example.com/', 'm1')).toBe('https://p.example.com/?m=m1');
  });

  it('shows only the host as the short URL hint', () => {
    expect(shortUrlHint('https://d123.cloudfront.net/?s=1&t=2')).toBe('d123.cloudfront.net');
  });
});
