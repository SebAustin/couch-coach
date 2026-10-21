import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { PollyClient } from '@aws-sdk/client-polly';
import { S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { vi } from 'vitest';

// Presigning signs locally; it only needs credentials to exist.
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.TABLE_NAME = 'tbl';
process.env.HMAC_SECRET_ARN = 'arn:secret';
process.env.AUDIO_BUCKET = 'audio-bucket';
process.env.EVENTS_HTTP_HOST = 'abc.appsync-api.us-east-1.amazonaws.com';
process.env.EVENTS_API_KEY = 'da2-testkey';
process.env.MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
process.env.POLLY_VOICE_ID = 'Matthew';
process.env.SELF_FUNCTION_NAME = 'couch-coach-coach';

export const mocks = {
  ddb: mockClient(DynamoDBDocumentClient),
  bedrock: mockClient(BedrockRuntimeClient),
  polly: mockClient(PollyClient),
  s3: mockClient(S3Client),
  lambda: mockClient(LambdaClient),
  secrets: mockClient(SecretsManagerClient),
};

export const SECRET = 'hmac-secret-for-tests';
export const SESSION_ID = 'ab'.repeat(16);

export function resetMocks() {
  for (const m of Object.values(mocks)) m.reset();
}

export interface PublishedEvent {
  url: string;
  headers: Record<string, string>;
  channel: string;
  message: Record<string, unknown>;
}

/** Stubs global fetch (the AppSync Events HTTP publish endpoint) and records what was published. */
export function stubEventsFetch(respond: () => Response = () => Response.json({ successful: [{ identifier: 'x', index: 0 }], failed: [] })) {
  const published: PublishedEvent[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    published.push({
      url,
      headers: init.headers as Record<string, string>,
      channel: body.channel,
      message: JSON.parse(body.events[0]),
    });
    return respond();
  });
  vi.stubGlobal('fetch', fetchMock);
  return { published, fetchMock };
}
