import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CoachMessage } from '@couch-coach/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetMocks, SESSION_ID, stubEventsFetch } from './helpers';
import { runCoachJob } from '../src/job';

const NOW = 1_800_000_000_000;
const job = {
  sessionId: SESSION_ID,
  memberId: 'm1',
  call: 2,
  setIndex: 3,
  set: { exercise: 'squat' as const, reps: 8, score: 80, faults: { knees_caving: 2 }, durationMs: 30_000 },
};

const audioStream = () => ({ transformToByteArray: async () => new Uint8Array([1, 2, 3]) }) as never;

function happyPath() {
  mocks.ddb.on(GetCommand).resolves({ Item: { name: 'Sam' } });
  mocks.ddb.on(QueryCommand).resolves({
    Items: [{ sk: 'SET#1', createdAt: NOW - 86_400_000, exercise: 'squat', reps: 10, score: 60, faults: { knees_caving: 6 }, cue: 'Watch the knees.' }],
  });
  mocks.ddb.on(PutCommand).resolves({});
  mocks.bedrock.on(ConverseCommand).resolves({ output: { message: { role: 'assistant', content: [{ text: 'Last time your knees caved, today they held. Nice work, Sam!' }] } } } as never);
  mocks.polly.on(SynthesizeSpeechCommand).resolves({ AudioStream: audioStream() });
  mocks.s3.on(PutObjectCommand).resolves({});
}

beforeEach(() => {
  resetMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('runCoachJob: happy path', () => {
  it('publishes thinking, then a schema-valid cue with presigned audio, on /coach/<id>, IAM-signed', async () => {
    happyPath();
    const { published, fetchMock } = stubEventsFetch();

    await runCoachJob(job);

    expect(published.map((p) => p.message.type)).toEqual(['thinking', 'cue']);
    for (const p of published) {
      expect(p.channel).toBe(`/coach/${SESSION_ID}`);
      expect(p.url).toBe('https://abc.appsync-api.us-east-1.amazonaws.com/event');
      expect(p.headers['x-api-key']).toBeUndefined();
      expect(p.headers.authorization ?? p.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
      expect(CoachMessage.safeParse(p.message).success).toBe(true);
    }
    expect(published[0]!.message).toMatchObject({ type: 'thinking', setIndex: 3 });
    const cue = published[1]!.message as { text: string; audioUrl: string; setIndex: number; t: number };
    expect(cue.text).toBe('Last time your knees caved, today they held. Nice work, Sam!');
    expect(cue.setIndex).toBe(3);
    expect(cue.t).toBe(NOW);
    const audio = new URL(cue.audioUrl);
    expect(audio.hostname).toBe('audio-bucket.s3.us-east-1.amazonaws.com');
    expect(audio.pathname).toBe(`/audio/${SESSION_ID}/2.mp3`);
    expect(audio.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('prompts Bedrock with this set and the Member history, using the configured profile', async () => {
    happyPath();
    stubEventsFetch();

    await runCoachJob(job);

    const input = mocks.bedrock.commandCalls(ConverseCommand)[0]!.args[0].input;
    expect(input.modelId).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(input.system![0]).toMatchObject({ text: expect.stringContaining('at most two short sentences') });
    const user = (input.messages![0]!.content![0] as { text: string }).text;
    expect(user).toContain('Sam');
    expect(user).toContain('knees caving on 2 of 8 reps');
    expect(user).toContain('Trend: improved vs the last squat set (yesterday). knees caving went from 6 of 10 reps to 2 of 8 reps.');
  });

  it('calls Bedrock with a capped output and a fixed temperature, never with topP as well', async () => {
    happyPath();
    stubEventsFetch();

    await runCoachJob(job);

    const input = mocks.bedrock.commandCalls(ConverseCommand)[0]!.args[0].input;
    expect(input.inferenceConfig).toEqual({ maxTokens: 80, temperature: 0.4 });
  });

  it('loads the last five sets, newest first, for the member', async () => {
    happyPath();
    stubEventsFetch();

    await runCoachJob(job);

    const q = mocks.ddb.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(q.ExpressionAttributeValues).toEqual({ ':pk': 'MEMBER#m1', ':sets': 'SET#' });
    expect(q.ScanIndexForward).toBe(false);
    expect(q.Limit).toBe(5);
  });

  it('synthesises with a neural English voice and stores the MP3 under audio/<sessionId>/<n>.mp3', async () => {
    happyPath();
    stubEventsFetch();

    await runCoachJob(job);

    expect(mocks.polly.commandCalls(SynthesizeSpeechCommand)[0]!.args[0].input).toMatchObject({
      Engine: 'neural',
      VoiceId: 'Matthew',
      OutputFormat: 'mp3',
      Text: 'Last time your knees caved, today they held. Nice work, Sam!',
    });
    expect(mocks.s3.commandCalls(PutObjectCommand)[0]!.args[0].input).toMatchObject({
      Bucket: 'audio-bucket',
      Key: `audio/${SESSION_ID}/2.mp3`,
      ContentType: 'audio/mpeg',
    });
  });

  it('stores the set as coach memory under MEMBER#<id>/SET#<ts> with the cue text and a TTL', async () => {
    happyPath();
    stubEventsFetch();

    await runCoachJob(job);

    const item = mocks.ddb.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(item).toMatchObject({
      pk: 'MEMBER#m1',
      sk: `SET#${NOW}`,
      sessionId: SESSION_ID,
      setIndex: 3,
      exercise: 'squat',
      reps: 8,
      score: 80,
      faults: { knees_caving: 2 },
      cue: 'Last time your knees caved, today they held. Nice work, Sam!',
    });
    expect(item.ttl).toBeGreaterThan(NOW / 1000);
  });
});

describe('runCoachJob: degradation (the TV never hangs)', () => {
  it('publishes a templated cue when Bedrock fails, and still adds voice', async () => {
    happyPath();
    mocks.bedrock.on(ConverseCommand).rejects(new Error('ThrottlingException'));
    const { published } = stubEventsFetch();

    await runCoachJob(job);

    const cue = published.find((p) => p.message.type === 'cue')!.message as { text: string; audioUrl?: string };
    expect(cue.text).toContain('Sam');
    expect(cue.text).toContain('knees caving');
    expect(cue.audioUrl).toBeDefined();
  });

  it('publishes a templated cue when Bedrock returns no text', async () => {
    happyPath();
    mocks.bedrock.on(ConverseCommand).resolves({ output: { message: { role: 'assistant', content: [] } } } as never);
    const { published } = stubEventsFetch();

    await runCoachJob(job);

    expect(published.at(-1)!.message.text).toContain('knees caving');
  });

  it('publishes a text-only cue when Polly fails', async () => {
    happyPath();
    mocks.polly.on(SynthesizeSpeechCommand).rejects(new Error('boom'));
    const { published } = stubEventsFetch();

    await runCoachJob(job);

    const cue = published.at(-1)!.message;
    expect(cue.type).toBe('cue');
    expect(cue.text).toContain('Last time your knees caved');
    expect(cue).not.toHaveProperty('audioUrl');
  });

  it('publishes a text-only cue when S3 fails', async () => {
    happyPath();
    mocks.s3.on(PutObjectCommand).rejects(new Error('denied'));
    const { published } = stubEventsFetch();

    await runCoachJob(job);

    expect(published.at(-1)!.message).not.toHaveProperty('audioUrl');
  });

  it('aborts a stalled S3 PUT after 3 s and publishes a text-only cue', async () => {
    happyPath();
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((ms) => (ms === 3_000 ? AbortSignal.abort(new DOMException('timed out', 'TimeoutError')) : realTimeout(ms)));
    // A PUT that never answers on its own: it only ends when its abort signal fires.
    mocks.s3.reset();
    mocks.s3.send.callsFake(
      (_cmd: unknown, opts?: { abortSignal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = opts?.abortSignal;
          if (!signal) return;
          if (signal.aborted) reject(signal.reason);
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    const { published } = stubEventsFetch();

    let timeoutsRequested: number[] = [];
    try {
      await runCoachJob(job);
      timeoutsRequested = timeoutSpy.mock.calls.map(([ms]) => ms);
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(timeoutsRequested).toContain(3_000);
    expect(mocks.s3.commandCalls(PutObjectCommand)).toHaveLength(1);
    const cue = published.at(-1)!.message;
    expect(cue.type).toBe('cue');
    expect(cue.text).toContain('Last time your knees caved');
    expect(cue).not.toHaveProperty('audioUrl');
  });

  it('still answers when history cannot be loaded', async () => {
    happyPath();
    mocks.ddb.on(QueryCommand).rejects(new Error('ddb down'));
    mocks.ddb.on(GetCommand).rejects(new Error('ddb down'));
    const { published } = stubEventsFetch();

    await runCoachJob(job);

    expect(published.at(-1)!.message.type).toBe('cue');
    const user = (mocks.bedrock.commandCalls(ConverseCommand)[0]!.args[0].input.messages![0]!.content![0] as { text: string }).text;
    expect(user).toMatch(/first set/i);
  });

  it('retries the cue publish once when AppSync rejects it', async () => {
    happyPath();
    let n = 0;
    const { fetchMock } = stubEventsFetch(() => (++n === 2 ? new Response('nope', { status: 500 }) : Response.json({ successful: [{}], failed: [] })));

    await runCoachJob(job);

    expect(fetchMock).toHaveBeenCalledTimes(3); // thinking, cue (500), cue retry
  });

  it('does not throw when publishing fails permanently', async () => {
    happyPath();
    stubEventsFetch(() => new Response('nope', { status: 500 }));

    await expect(runCoachJob(job)).resolves.toBeUndefined();
  });

  it('treats a 200 with failed events as a failed publish', async () => {
    happyPath();
    const { fetchMock } = stubEventsFetch(() => Response.json({ successful: [], failed: [{ identifier: 'x', index: 0, errorCode: 'UnauthorizedException' }] }));

    await runCoachJob(job);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(2); // retried
  });
});
