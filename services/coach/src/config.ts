/** Read lazily so tests (and cold starts) see the environment as it is when a request arrives. */
export const config = () => ({
  table: process.env.TABLE_NAME!,
  secretArn: process.env.HMAC_SECRET_ARN!,
  audioBucket: process.env.AUDIO_BUCKET!,
  eventsHost: process.env.EVENTS_HTTP_HOST!,
  eventsApiKey: process.env.EVENTS_API_KEY!,
  modelId: process.env.MODEL_ID!,
  voiceId: process.env.POLLY_VOICE_ID ?? 'Matthew',
  selfFunctionName: process.env.SELF_FUNCTION_NAME!,
});

export const BEDROCK_TIMEOUT_MS = 6_000;
export const POLLY_TIMEOUT_MS = 4_000;
export const AUDIO_URL_TTL_S = 15 * 60;
/** Coach memory is kept for 90 days. */
export const SET_TTL_S = 90 * 24 * 60 * 60;
export const HISTORY_SETS = 5;
