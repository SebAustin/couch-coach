import { randomBytes } from 'node:crypto';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  CreateMemberRequest,
  SessionRequest,
  SessionResponse,
  type Member,
} from '@couch-coach/protocol';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ddb, getSecretString } from './aws';
import { error, json, parseJsonBody } from '../../shared/http';
import { errorFields, log } from '../../shared/logger';
import { newSessionId, signPhoneToken } from '../../shared/token';

/** One Household per install; keeps the unauthenticated member list bounded. */
const HOUSEHOLD = 'HOUSEHOLD#default';
const MEMBERS_INDEX = 'byHousehold';
export const MAX_MEMBERS = 20;
const SESSION_ROW_GRACE_S = 60 * 60;

const env = () => ({
  table: process.env.TABLE_NAME!,
  secretArn: process.env.HMAC_SECRET_ARN!,
  phoneBaseUrl: process.env.PHONE_BASE_URL!.replace(/\/+$/, ''),
});

async function listMembers(table: string): Promise<Member[]> {
  const out = await ddb.send(
    new QueryCommand({
      TableName: table,
      IndexName: MEMBERS_INDEX,
      KeyConditionExpression: 'gsi1pk = :h',
      ExpressionAttributeValues: { ':h': HOUSEHOLD },
      Limit: MAX_MEMBERS + 1,
    }),
  );
  return (out.Items ?? []).map((i) => ({
    memberId: String(i.memberId),
    name: String(i.name),
    ...(typeof i.lastSeenAt === 'number' ? { lastSeenAt: i.lastSeenAt } : {}),
  }));
}

async function createMember(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const parsed = CreateMemberRequest.safeParse(parseJsonBody(event));
  if (!parsed.success) return error(400, 'name is required (1-40 characters)');
  const { table } = env();

  if ((await listMembers(table)).length >= MAX_MEMBERS) return error(409, `household is full (${MAX_MEMBERS} members)`);

  const memberId = randomBytes(8).toString('hex');
  const now = Date.now();
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        pk: `MEMBER#${memberId}`,
        sk: 'PROFILE',
        gsi1pk: HOUSEHOLD,
        gsi1sk: String(now).padStart(15, '0'),
        memberId,
        name: parsed.data.name,
        createdAt: now,
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  );
  log('info', 'member created', { memberId });
  const member: Member = { memberId, name: parsed.data.name };
  return json(201, member);
}

async function createSession(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const parsed = SessionRequest.safeParse(parseJsonBody(event));
  if (!parsed.success) return error(400, 'memberId is required');
  const { table, secretArn, phoneBaseUrl } = env();
  const { memberId } = parsed.data;

  const member = await ddb.send(
    new GetCommand({ TableName: table, Key: { pk: `MEMBER#${memberId}`, sk: 'PROFILE' } }),
  );
  if (!member.Item) return error(404, 'unknown member');

  const sessionId = newSessionId();
  const now = Date.now();
  const { token, exp } = signPhoneToken(sessionId, await getSecretString(secretArn), now);

  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        pk: `SESSION#${sessionId}`,
        sk: 'META',
        memberId,
        exp,
        coachCalls: 0,
        ttl: Math.floor(exp / 1000) + SESSION_ROW_GRACE_S,
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  );
  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { pk: `MEMBER#${memberId}`, sk: 'PROFILE' },
      UpdateExpression: 'SET lastSeenAt = :now',
      ExpressionAttributeValues: { ':now': now },
    }),
  );

  const phoneUrl = `${phoneBaseUrl}/?s=${sessionId}&t=${encodeURIComponent(token)}`;
  log('info', 'session created', { sessionId, memberId, expiresAt: exp });
  return json(201, SessionResponse.parse({ sessionId, phoneToken: token, phoneUrl, expiresAt: exp, memberId }));
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    switch (event.routeKey) {
      case 'GET /members':
        return json(200, { members: await listMembers(env().table) });
      case 'POST /members':
        return await createMember(event);
      case 'POST /session':
        return await createSession(event);
      default:
        return error(404, 'not found');
    }
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return error(409, 'conflict, retry');
    log('error', 'session handler failed', { routeKey: event.routeKey, ...errorFields(err) });
    return error(500, 'internal error');
  }
}
