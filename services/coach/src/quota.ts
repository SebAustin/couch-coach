import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { type DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

/** Global ceiling on coach calls per UTC day, whoever makes them: caps Bedrock + Polly spend. */
export const DAILY_COACH_LIMIT = 300;
const QUOTA_ROW_TTL_S = 2 * 24 * 60 * 60;

export const quotaKey = (nowMs: number) => ({
  pk: `QUOTA#${new Date(nowMs).toISOString().slice(0, 10)}`,
  sk: 'DAY',
});

/** One conditional UpdateItem on QUOTA#<yyyy-mm-dd>: same atomic pattern as the per-Session cap. */
export async function reserveDailyCall(
  ddb: DynamoDBDocumentClient,
  table: string,
  nowMs: number,
  limit: number,
): Promise<{ ok: true; count: number } | { ok: false }> {
  try {
    const out = await ddb.send(
      new UpdateCommand({
        TableName: table,
        Key: quotaKey(nowMs),
        UpdateExpression: 'ADD n :one SET #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression: 'attribute_not_exists(n) OR n < :max',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':max': limit, ':ttl': Math.floor(nowMs / 1000) + QUOTA_ROW_TTL_S },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return { ok: true, count: Number(out.Attributes?.n) };
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return { ok: false };
    throw err;
  }
}
