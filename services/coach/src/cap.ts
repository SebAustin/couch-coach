import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { type DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

/** Hard ceiling on Bedrock/Polly spend: coach calls per Session. */
export const MAX_COACH_CALLS = 30;

export type Reservation =
  | { ok: true; call: number; memberId: string }
  | { ok: false; reason: 'no_session' | 'cap_exceeded' };

/**
 * Atomically claims one coach call on the SESSION#<id>/META row. The single conditional
 * UpdateItem both verifies the row exists and enforces the cap, so concurrent requests
 * cannot overshoot it.
 */
export async function reserveCoachCall(
  ddb: DynamoDBDocumentClient,
  table: string,
  sessionId: string,
): Promise<Reservation> {
  try {
    const out = await ddb.send(
      new UpdateCommand({
        TableName: table,
        Key: { pk: `SESSION#${sessionId}`, sk: 'META' },
        UpdateExpression: 'ADD coachCalls :one',
        ConditionExpression: 'attribute_exists(pk) AND (attribute_not_exists(coachCalls) OR coachCalls < :max)',
        ExpressionAttributeValues: { ':one': 1, ':max': MAX_COACH_CALLS },
        ReturnValues: 'ALL_NEW',
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      }),
    );
    const memberId = out.Attributes?.memberId;
    // A row without a memberId would otherwise become the string "undefined" and pool memory across people.
    if (typeof memberId !== 'string' || memberId === '') return { ok: false, reason: 'no_session' };
    return { ok: true, call: Number(out.Attributes?.coachCalls), memberId };
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return { ok: false, reason: err.Item ? 'cap_exceeded' : 'no_session' };
    }
    throw err;
  }
}
