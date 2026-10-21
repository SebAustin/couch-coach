import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { SetSummary } from '@couch-coach/protocol';
import { ddb } from './aws';
import { HISTORY_SETS, SET_TTL_S, config } from './config';
import type { HistorySet } from './prompt';

export async function loadMemberName(memberId: string): Promise<string> {
  const out = await ddb.send(
    new GetCommand({ TableName: config().table, Key: { pk: `MEMBER#${memberId}`, sk: 'PROFILE' } }),
  );
  return typeof out.Item?.name === 'string' ? out.Item.name : 'there';
}

/** The Member's last five Sets, newest first: this is the Coach's memory. */
export async function loadHistory(memberId: string): Promise<HistorySet[]> {
  const out = await ddb.send(
    new QueryCommand({
      TableName: config().table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sets)',
      ExpressionAttributeValues: { ':pk': `MEMBER#${memberId}`, ':sets': 'SET#' },
      ScanIndexForward: false,
      Limit: HISTORY_SETS,
    }),
  );
  return (out.Items ?? []).map((i) => ({
    createdAt: Number(i.createdAt),
    exercise: String(i.exercise),
    reps: Number(i.reps),
    score: Number(i.score),
    faults: (i.faults ?? {}) as Record<string, number>,
    ...(typeof i.cue === 'string' ? { cue: i.cue } : {}),
  }));
}

export async function saveSet(args: {
  memberId: string;
  sessionId: string;
  setIndex: number;
  set: SetSummary;
  cue: string;
  nowMs: number;
}): Promise<void> {
  const { memberId, sessionId, setIndex, set, cue, nowMs } = args;
  await ddb.send(
    new PutCommand({
      TableName: config().table,
      Item: {
        pk: `MEMBER#${memberId}`,
        sk: `SET#${nowMs}`,
        createdAt: nowMs,
        sessionId,
        setIndex,
        exercise: set.exercise,
        reps: set.reps,
        score: set.score,
        faults: set.faults,
        durationMs: set.durationMs,
        cue,
        ttl: Math.floor(nowMs / 1000) + SET_TTL_S,
      },
    }),
  );
}
