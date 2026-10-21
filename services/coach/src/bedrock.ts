import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { BEDROCK_TIMEOUT_MS, config } from './config';

const bedrock = new BedrockRuntimeClient({});
const MAX_OUTPUT_TOKENS = 120;

/** One Converse call to the Haiku inference profile. Returns the raw text (undefined if empty); throws on failure. */
export async function converseCue(prompt: { system: string; user: string }): Promise<string | undefined> {
  const out = await bedrock.send(
    new ConverseCommand({
      modelId: config().modelId,
      system: [{ text: prompt.system }],
      messages: [{ role: 'user', content: [{ text: prompt.user }] }],
      inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS },
    }),
    { abortSignal: AbortSignal.timeout(BEDROCK_TIMEOUT_MS) },
  );
  return out.output?.message?.content?.find((block) => typeof block.text === 'string')?.text;
}
