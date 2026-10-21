import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AUDIO_URL_TTL_S, POLLY_TIMEOUT_MS, config } from './config';

const polly = new PollyClient({});
const s3 = new S3Client({});

/** Polly neural MP3 -> S3 audio/<sessionId>/<n>.mp3 -> 15 minute presigned GET. Throws on any failure. */
export async function synthesizeToUrl(text: string, sessionId: string, n: number): Promise<string> {
  const { audioBucket, voiceId } = config();
  const speech = await polly.send(
    new SynthesizeSpeechCommand({
      Engine: 'neural',
      VoiceId: voiceId as never,
      LanguageCode: 'en-US',
      OutputFormat: 'mp3',
      TextType: 'text',
      Text: text,
    }),
    { abortSignal: AbortSignal.timeout(POLLY_TIMEOUT_MS) },
  );
  if (!speech.AudioStream) throw new Error('Polly returned no audio');
  const body = await speech.AudioStream.transformToByteArray();

  const Key = `audio/${sessionId}/${n}.mp3`;
  await s3.send(new PutObjectCommand({ Bucket: audioBucket, Key, Body: body, ContentType: 'audio/mpeg' }));
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: audioBucket, Key }), { expiresIn: AUDIO_URL_TTL_S });
}
