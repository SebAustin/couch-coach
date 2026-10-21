import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SessionResponse } from '@couch-coach/protocol';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { verifyPhoneToken } from '../../shared/token';
import { MAX_MEMBERS, handler } from '../src/handler';

const ddbMock = mockClient(DynamoDBDocumentClient);
const secretsMock = mockClient(SecretsManagerClient);
const SECRET = 'hmac-secret-for-tests';

process.env.TABLE_NAME = 'tbl';
process.env.HMAC_SECRET_ARN = 'arn:secret';
process.env.PHONE_BASE_URL = 'https://dphone.cloudfront.net/';

const call = (routeKey: string, body?: unknown) =>
  handler({ routeKey, body: body === undefined ? undefined : JSON.stringify(body) } as never);
const bodyOf = (r: { body?: string }) => JSON.parse(r.body!);

beforeEach(() => {
  ddbMock.reset();
  secretsMock.reset();
  secretsMock.on(GetSecretValueCommand).resolves({ SecretString: SECRET });
});

describe('GET /members', () => {
  it('lists the household members from the household index', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { memberId: 'm1', name: 'Sam', lastSeenAt: 5 },
        { memberId: 'm2', name: 'Alex' },
      ],
    });

    const res = await call('GET /members');

    expect(res.statusCode).toBe(200);
    expect(bodyOf(res)).toEqual({ members: [{ memberId: 'm1', name: 'Sam', lastSeenAt: 5 }, { memberId: 'm2', name: 'Alex' }] });
    expect(ddbMock.commandCalls(QueryCommand)[0]!.args[0].input.IndexName).toBe('byHousehold');
  });
});

describe('POST /members', () => {
  it('creates a member and returns 201 with the Member shape', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});

    const res = await call('POST /members', { name: '  Sam  ' });

    expect(res.statusCode).toBe(201);
    const member = bodyOf(res);
    expect(member).toEqual({ memberId: expect.stringMatching(/^[0-9a-f]{16}$/), name: 'Sam' });
    const item = ddbMock.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(item).toMatchObject({ pk: `MEMBER#${member.memberId}`, sk: 'PROFILE', name: 'Sam', gsi1pk: 'HOUSEHOLD#default' });
  });

  it.each([undefined, {}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(41) }, { name: 5 }])('rejects invalid body %j with 400', async (bad) => {
    const res = await call('POST /members', bad);

    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('returns 409 once the household is full', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: Array.from({ length: MAX_MEMBERS }, (_, i) => ({ memberId: `m${i}`, name: 'n' })) });

    const res = await call('POST /members', { name: 'Late' });

    expect(res.statusCode).toBe(409);
  });
});

describe('POST /session', () => {
  beforeEach(() => {
    ddbMock.on(GetCommand).resolves({ Item: { pk: 'MEMBER#m1', sk: 'PROFILE', memberId: 'm1', name: 'Sam' } });
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});
  });

  it('returns a 128-bit sessionId, a verifiable 2h token and the phone URL', async () => {
    const before = Date.now();

    const res = await call('POST /session', { memberId: 'm1' });

    expect(res.statusCode).toBe(201);
    const session = SessionResponse.parse(bodyOf(res));
    expect(session.sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect(session.memberId).toBe('m1');
    expect(session.phoneUrl).toBe(`https://dphone.cloudfront.net/?s=${session.sessionId}&t=${session.phoneToken}`);
    expect(session.expiresAt - before).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
    expect(verifyPhoneToken(session.phoneToken, session.sessionId, SECRET, Date.now())).toEqual({ ok: true, exp: session.expiresAt });
  });

  it('stores the SESSION#<id>/META row with member, expiry, zeroed counter and a TTL in epoch seconds', async () => {
    const res = await call('POST /session', { memberId: 'm1' });
    const session = bodyOf(res);

    const item = ddbMock.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(item).toMatchObject({ pk: `SESSION#${session.sessionId}`, sk: 'META', memberId: 'm1', exp: session.expiresAt, coachCalls: 0 });
    expect(item.ttl).toBeGreaterThan(Math.floor(session.expiresAt / 1000));
    expect(item.ttl).toBeLessThan(session.expiresAt); // seconds, not milliseconds
  });

  it('returns 404 for an unknown member and creates nothing', async () => {
    ddbMock.on(GetCommand).resolves({});

    const res = await call('POST /session', { memberId: 'ghost' });

    expect(res.statusCode).toBe(404);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('returns 400 without a memberId', async () => {
    expect((await call('POST /session', {})).statusCode).toBe(400);
  });
});

describe('errors', () => {
  it('returns 404 for unknown routes', async () => {
    expect((await call('DELETE /members')).statusCode).toBe(404);
  });

  it('maps a lost conditional write to 409', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).rejects(new ConditionalCheckFailedException({ message: 'x', $metadata: {} }));

    expect((await call('POST /members', { name: 'Sam' })).statusCode).toBe(409);
  });

  it('hides internal failures behind a generic 500', async () => {
    ddbMock.on(QueryCommand).rejects(new Error('secret table name leaked'));

    const res = await call('GET /members');

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret table name');
  });
});
