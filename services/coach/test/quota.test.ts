import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { DAILY_COACH_LIMIT, quotaKey, reserveDailyCall } from '../src/quota';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const ddbMock = mockClient(ddb);
beforeEach(() => ddbMock.reset());

const NOON_UTC = Date.UTC(2026, 9, 21, 12, 0, 0);

describe('quotaKey', () => {
  it('buckets by UTC calendar day', () => {
    expect(quotaKey(Date.UTC(2026, 9, 21, 23, 59, 59))).toEqual({ pk: 'QUOTA#2026-10-21', sk: 'DAY' });
    expect(quotaKey(Date.UTC(2026, 9, 22, 0, 0, 0))).toEqual({ pk: 'QUOTA#2026-10-22', sk: 'DAY' });
  });
});

describe('reserveDailyCall', () => {
  it('defaults to a global ceiling of 300 coach calls per day', () => {
    expect(DAILY_COACH_LIMIT).toBe(300);
  });

  it('grants a call and reports the day count', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { n: 17 } });

    expect(await reserveDailyCall(ddb, 'tbl', NOON_UTC, 300)).toEqual({ ok: true, count: 17 });
  });

  it('is one atomic conditional increment that also stamps a TTL so old days expire', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { n: 1 } });

    await reserveDailyCall(ddb, 'tbl', NOON_UTC, 250);

    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.Key).toEqual({ pk: 'QUOTA#2026-10-21', sk: 'DAY' });
    expect(input.ConditionExpression).toBe('attribute_not_exists(n) OR n < :max');
    expect(input.UpdateExpression).toContain('ADD n :one');
    expect(input.ExpressionAttributeValues).toMatchObject({ ':one': 1, ':max': 250 });
    // "ttl" is a DynamoDB reserved word, so it must go through an expression attribute name.
    expect(input.ExpressionAttributeNames).toEqual({ '#ttl': 'ttl' });
    const ttl = input.ExpressionAttributeValues![':ttl'] as number;
    expect(ttl).toBeGreaterThan(NOON_UTC / 1000);
    expect(ttl).toBeLessThan(NOON_UTC / 1000 + 3 * 24 * 3600);
  });

  it('refuses once the ceiling is reached', async () => {
    ddbMock.on(UpdateCommand).rejects(new ConditionalCheckFailedException({ message: 'x', $metadata: {} }));

    expect(await reserveDailyCall(ddb, 'tbl', NOON_UTC, 300)).toEqual({ ok: false });
  });

  it('propagates unexpected failures', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('throttled'));

    await expect(reserveDailyCall(ddb, 'tbl', NOON_UTC, 300)).rejects.toThrow('throttled');
  });
});
