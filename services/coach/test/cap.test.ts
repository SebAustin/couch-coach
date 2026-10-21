import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_COACH_CALLS, reserveCoachCall } from '../src/cap';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const ddbMock = mockClient(ddb);
const SID = 'a'.repeat(32);
const conditionFailed = (item?: Record<string, unknown>) =>
  new ConditionalCheckFailedException({ message: 'cond', $metadata: {}, Item: item as never });

beforeEach(() => ddbMock.reset());

describe('reserveCoachCall', () => {
  it('allows 30 calls per session', () => {
    expect(MAX_COACH_CALLS).toBe(30);
  });

  it('grants the call and reports the new count and the session member', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { coachCalls: 3, memberId: 'm1' } });

    const result = await reserveCoachCall(ddb, 'tbl', SID);

    expect(result).toEqual({ ok: true, call: 3, memberId: 'm1' });
  });

  it('increments atomically, only when the session exists and is under the cap', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { coachCalls: 1, memberId: 'm1' } });

    await reserveCoachCall(ddb, 'tbl', SID);

    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.Key).toEqual({ pk: `SESSION#${SID}`, sk: 'META' });
    expect(input.UpdateExpression).toBe('ADD coachCalls :one');
    expect(input.ConditionExpression).toContain('attribute_exists(pk)');
    expect(input.ConditionExpression).toContain('coachCalls < :max');
    expect(input.ExpressionAttributeValues).toEqual({ ':one': 1, ':max': 30 });
    expect(input.ReturnValuesOnConditionCheckFailure).toBe('ALL_OLD');
  });

  it('reports cap_exceeded when the session row exists but is at the limit', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed({ coachCalls: { N: '30' }, memberId: { S: 'm1' } }));

    const result = await reserveCoachCall(ddb, 'tbl', SID);

    expect(result).toEqual({ ok: false, reason: 'cap_exceeded' });
  });

  it('reports no_session when the condition failed because there is no row', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed(undefined));

    const result = await reserveCoachCall(ddb, 'tbl', SID);

    expect(result).toEqual({ ok: false, reason: 'no_session' });
  });

  it('propagates unexpected DynamoDB failures', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('throttled'));

    await expect(reserveCoachCall(ddb, 'tbl', SID)).rejects.toThrow('throttled');
  });
});
