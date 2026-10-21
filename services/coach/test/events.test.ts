import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coachChannel, publishCoachMessage } from '../src/events';
import './helpers';

const SID = 'ab'.repeat(16);
const HOST = 'abc.appsync-api.us-east-1.amazonaws.com';

let calls: { url: string; init: RequestInit }[];
const stubFetch = (respond: () => Response = () => Response.json({ successful: [{ identifier: 'x', index: 0 }], failed: [] })) => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond();
    }),
  );
};
const headersOf = (i: number) => Object.fromEntries(Object.entries(calls[i]!.init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));

beforeEach(() => {
  process.env.AWS_SESSION_TOKEN = 'session-token-123';
});
afterEach(() => vi.unstubAllGlobals());

describe('coachChannel', () => {
  it('puts Coach messages on their own namespace, /coach/<sessionId>', () => {
    expect(coachChannel(SID)).toBe(`/coach/${SID}`);
  });
});

describe('publishCoachMessage (IAM / SigV4)', () => {
  const message = { type: 'thinking', setIndex: 1, t: 5 } as const;

  it('POSTs the event to the Events HTTP endpoint on /coach/<id>', async () => {
    stubFetch();

    expect(await publishCoachMessage(SID, message)).toBe(true);

    expect(calls[0]!.url).toBe(`https://${HOST}/event`);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.channel).toBe(`/coach/${SID}`);
    expect(JSON.parse(body.events[0])).toEqual(message);
  });

  it('authenticates with a SigV4 signature for the appsync service, never an API key', async () => {
    stubFetch();

    await publishCoachMessage(SID, message);

    const h = headersOf(0);
    expect(h['x-api-key']).toBeUndefined();
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=test\/\d{8}\/us-east-1\/appsync\/aws4_request, SignedHeaders=.*host.*, Signature=[0-9a-f]{64}$/);
    expect(h['x-amz-security-token']).toBe('session-token-123');
    expect(h['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('does not set a host header itself (fetch derives it)', async () => {
    stubFetch();

    await publishCoachMessage(SID, message);

    expect(headersOf(0).host).toBeUndefined();
  });

  it('signs the exact body it sends (payload hash matches)', async () => {
    stubFetch();

    await publishCoachMessage(SID, message);
    await publishCoachMessage(SID, { ...message, setIndex: 2 });

    expect(headersOf(0).authorization).not.toBe(headersOf(1).authorization);
  });

  it('retries once on an HTTP error, re-signing the retry', async () => {
    let n = 0;
    stubFetch(() => (++n === 1 ? new Response('no', { status: 403 }) : Response.json({ successful: [{}], failed: [] })));

    expect(await publishCoachMessage(SID, message)).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('treats failed events in a 200 response as a failed publish and gives up after one retry', async () => {
    stubFetch(() => Response.json({ successful: [], failed: [{ identifier: 'x', index: 0, errorCode: 'UnauthorizedException' }] }));

    expect(await publishCoachMessage(SID, message)).toBe(false);
    expect(calls).toHaveLength(2);
  });
});
