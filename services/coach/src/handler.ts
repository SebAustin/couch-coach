import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { CoachRequest } from '@couch-coach/protocol';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { error, json, parseJsonBody } from '../../shared/http';
import { errorFields, log } from '../../shared/logger';
import { verifyPhoneToken } from '../../shared/token';
import { ddb, getSecretString } from './aws';
import { reserveCoachCall } from './cap';
import { config } from './config';
import { runCoachJob, type CoachJob } from './job';

const lambda = new LambdaClient({});

type JobEvent = CoachJob & { kind: 'coach-job' };
const isJobEvent = (event: unknown): event is JobEvent =>
  typeof event === 'object' && event !== null && (event as { kind?: unknown }).kind === 'coach-job';

/**
 * Admission control for POST /coach: validate, verify the token, claim one of the session's 30 calls,
 * then return 202 immediately. The slow part (Bedrock + Polly) runs in an async self-invoke so the
 * phone never waits on it; the Cue arrives over AppSync Events.
 */
async function admit(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const parsed = CoachRequest.safeParse(parseJsonBody(event));
  if (!parsed.success) return error(400, 'invalid request');
  const { sessionId, token, setIndex, set } = parsed.data;
  const { table, secretArn, selfFunctionName } = config();

  const check = verifyPhoneToken(token, sessionId, await getSecretString(secretArn), Date.now());
  if (!check.ok) {
    log('warn', 'token rejected', { sessionId, reason: check.reason });
    return error(401, 'invalid or expired token');
  }

  const reservation = await reserveCoachCall(ddb, table, sessionId);
  if (!reservation.ok) {
    log('warn', 'coach call refused', { sessionId, reason: reservation.reason });
    return reservation.reason === 'cap_exceeded' ? error(429, 'coach call limit reached for this session') : error(401, 'unknown session');
  }

  const job: JobEvent = { kind: 'coach-job', sessionId, memberId: reservation.memberId, call: reservation.call, setIndex, set };
  try {
    await lambda.send(
      new InvokeCommand({ FunctionName: selfFunctionName, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(job)) }),
    );
  } catch (err) {
    // The call is already counted; do the work inline rather than leave the TV waiting for a Cue.
    log('error', 'async hand-off failed, running inline', { sessionId, ...errorFields(err) });
    await runCoachJob(job);
  }
  log('info', 'coach call accepted', { sessionId, call: reservation.call, setIndex });
  return json(202, { ok: true });
}

export async function handler(event: APIGatewayProxyEventV2 | JobEvent): Promise<APIGatewayProxyStructuredResultV2 | undefined> {
  if (isJobEvent(event)) {
    await runCoachJob(event);
    return undefined;
  }
  try {
    return await admit(event);
  } catch (err) {
    log('error', 'coach handler failed', { ...errorFields(err) });
    return error(500, 'internal error');
  }
}
