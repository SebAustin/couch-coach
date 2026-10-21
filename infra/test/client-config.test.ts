import { describe, expect, it } from 'vitest';
import { toClientConfig } from '../scripts/write-client-config';

const outputs = {
  CouchCoachStack: {
    apiBaseUrl: 'https://abc123.execute-api.us-east-1.amazonaws.com',
    eventsHttpHost: 'x.appsync-api.us-east-1.amazonaws.com',
    eventsRealtimeHost: 'x.appsync-realtime-api.us-east-1.amazonaws.com',
    eventsApiKey: 'da2-abc',
    phoneUrl: 'https://d111.cloudfront.net',
    bedrockProfileId: 'ignored-extra-output',
  },
};

describe('toClientConfig', () => {
  it('maps the stack outputs to exactly the ClientConfig shape', () => {
    expect(toClientConfig(outputs)).toEqual({
      apiBaseUrl: 'https://abc123.execute-api.us-east-1.amazonaws.com',
      eventsHttpHost: 'x.appsync-api.us-east-1.amazonaws.com',
      eventsRealtimeHost: 'x.appsync-realtime-api.us-east-1.amazonaws.com',
      eventsApiKey: 'da2-abc',
      phoneUrl: 'https://d111.cloudfront.net',
    });
  });

  it('fails loudly when the stack key or an output is missing', () => {
    expect(() => toClientConfig({})).toThrow(/CouchCoachStack/);
    const { phoneUrl: _drop, ...partial } = outputs.CouchCoachStack;
    expect(() => toClientConfig({ CouchCoachStack: partial })).toThrow();
  });

  it('rejects a non-URL phoneUrl', () => {
    expect(() => toClientConfig({ CouchCoachStack: { ...outputs.CouchCoachStack, phoneUrl: 'nope' } })).toThrow();
  });
});
