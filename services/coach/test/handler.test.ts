import { InvokeCommand } from '@aws-sdk/client-lambda';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signPhoneToken } from '../../shared/token';
import { handler } from '../src/handler';
import { mocks, resetMocks, SECRET, SESSION_ID, stubEventsFetch } from './helpers';

const set = { exercise: 'squat', reps: 8, score: 80, faults: { knees_caving: 2 }, durationMs: 30_000 };
const validToken = () => signPhoneToken(SESSION_ID, SECRET, Date.now()).token;
const request = (over: Record<string, unknown> = {}) => ({
  sessionId: SESSION_ID,
  token: validToken(),
  setIndex: 2,
  set,
  ...over,
});
const post = async (body: unknown) => {
  const res = await handler({ routeKey: 'POST /coach', body: typeof body === 'string' ? body : JSON.stringify(body) } as never);
  return res as NonNullable<typeof res>;
};

beforeEach(() => {
  resetMocks();
  mocks.secrets.on(GetSecretValueCommand).resolves({ SecretString: SECRET });
  mocks.ddb.on(UpdateCommand).resolves({ Attributes: { coachCalls: 4, memberId: 'm1' } });
  mocks.lambda.on(InvokeCommand).resolves({ StatusCode: 202 });
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /coach: admission', () => {
  it('returns 202 { ok: true } and hands the work to an async self-invoke', async () => {
    const res = await post(request());

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body!)).toEqual({ ok: true });
    const input = mocks.lambda.commandCalls(InvokeCommand)[0]!.args[0].input;
    expect(input.FunctionName).toBe('couch-coach-coach');
    expect(input.InvocationType).toBe('Event');
    const payload = JSON.parse(Buffer.from(input.Payload as Uint8Array).toString());
    expect(payload).toEqual({
      kind: 'coach-job',
      sessionId: SESSION_ID,
      memberId: 'm1',
      call: 4,
      setIndex: 2,
      set,
    });
  });

  it('defaults setIndex to 1 as the protocol does', async () => {
    const { setIndex: _drop, ...rest } = request();

    await post(rest);

    const payload = JSON.parse(Buffer.from(mocks.lambda.commandCalls(InvokeCommand)[0]!.args[0].input.Payload as Uint8Array).toString());
    expect(payload.setIndex).toBe(1);
  });

  it.each([
    ['malformed JSON', '{nope'],
    ['empty body', ''],
    ['missing set', { sessionId: SESSION_ID, token: 'x' }],
    ['bad session id', request({ sessionId: 'short' })],
    ['negative reps', request({ set: { ...set, reps: -1 } })],
    ['unknown exercise', request({ set: { ...set, exercise: 'burpee' } })],
  ])('rejects %s with 400 before touching AWS', async (_name, body) => {
    const res = await post(body);

    expect(res.statusCode).toBe(400);
    expect(mocks.ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(mocks.lambda.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('rejects a token signed with the wrong secret with 401 and burns no call', async () => {
    const forged = signPhoneToken(SESSION_ID, 'attacker-secret', Date.now()).token;

    const res = await post(request({ token: forged }));

    expect(res.statusCode).toBe(401);
    expect(mocks.ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('rejects an expired token with 401', async () => {
    const expired = signPhoneToken(SESSION_ID, SECRET, Date.now() - 3 * 60 * 60 * 1000).token;

    expect((await post(request({ token: expired }))).statusCode).toBe(401);
  });

  it('rejects a token minted for another session with 401', async () => {
    const other = signPhoneToken('cd'.repeat(16), SECRET, Date.now()).token;

    expect((await post(request({ token: other }))).statusCode).toBe(401);
  });

  it('returns 401 when the session row is gone', async () => {
    mocks.ddb.on(UpdateCommand).rejects(new ConditionalCheckFailedException({ message: 'x', $metadata: {} }));

    expect((await post(request())).statusCode).toBe(401);
  });

  it('returns 429 once the per-session cap is reached', async () => {
    mocks.ddb.on(UpdateCommand).rejects(new ConditionalCheckFailedException({ message: 'x', $metadata: {}, Item: { coachCalls: { N: '30' } } as never }));

    const res = await post(request());

    expect(res.statusCode).toBe(429);
    expect(mocks.lambda.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('hides internal failures behind a generic 500', async () => {
    mocks.ddb.on(UpdateCommand).rejects(new Error('table arn leaked'));

    const res = await post(request());

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('leaked');
  });
});

describe('POST /coach: when the async hand-off fails', () => {
  it('falls back to doing the work inline so the TV still gets a cue', async () => {
    mocks.lambda.on(InvokeCommand).rejects(new Error('AccessDenied'));
    mocks.ddb.on(GetCommand).resolves({ Item: { name: 'Sam' } });
    mocks.ddb.on(QueryCommand).resolves({ Items: [] });
    mocks.ddb.on(PutCommand).resolves({});
    mocks.bedrock.on(ConverseCommand).resolves({ output: { message: { role: 'assistant', content: [{ text: 'Nice set, Sam!' }] } } } as never);
    mocks.polly.on(SynthesizeSpeechCommand).resolves({ AudioStream: { transformToByteArray: async () => new Uint8Array([1]) } as never });
    mocks.s3.on(PutObjectCommand).resolves({});
    const { published } = stubEventsFetch();

    const res = await post(request());

    expect(res.statusCode).toBe(202);
    expect(published.map((p) => p.message.type)).toEqual(['thinking', 'cue']);
  });
});

describe('async job invocation', () => {
  it('runs the job when invoked with a coach-job payload (no HTTP response)', async () => {
    mocks.ddb.on(GetCommand).resolves({ Item: { name: 'Sam' } });
    mocks.ddb.on(QueryCommand).resolves({ Items: [] });
    mocks.ddb.on(PutCommand).resolves({});
    mocks.bedrock.on(ConverseCommand).resolves({ output: { message: { role: 'assistant', content: [{ text: 'Strong set!' }] } } } as never);
    mocks.polly.on(SynthesizeSpeechCommand).resolves({ AudioStream: { transformToByteArray: async () => new Uint8Array([1]) } as never });
    mocks.s3.on(PutObjectCommand).resolves({});
    const { published } = stubEventsFetch();

    const result = await handler({ kind: 'coach-job', sessionId: SESSION_ID, memberId: 'm1', call: 1, setIndex: 1, set } as never);

    expect(result).toBeUndefined();
    expect(published.at(-1)!.message).toMatchObject({ type: 'cue', text: 'Strong set!' });
  });
});
