import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { BEDROCK_TIMEOUT_MS, config } from './config';

const bedrock = new BedrockRuntimeClient({});
/**
 * A 35-word Cue is ~50 tokens; 80 leaves headroom but stops a rambling reply early (cleanCueText then keeps
 * the complete sentences). Temperature is set for steadier Cues; Haiku 4.5 rejects temperature + topP together,
 * so topP stays unset. Exported so the eval records exactly what it ran with.
 */
export const INFERENCE_CONFIG = { maxTokens: 80, temperature: 0.4 } as const;

/** One Converse call to the Haiku inference profile. Returns the raw text (undefined if empty); throws on failure. */
export async function converseCue(prompt: { system: string; user: string }): Promise<string | undefined> {
  const out = await bedrock.send(
    new ConverseCommand({
      modelId: config().modelId,
      system: [{ text: prompt.system }],
      messages: [{ role: 'user', content: [{ text: prompt.user }] }],
      inferenceConfig: { ...INFERENCE_CONFIG },
    }),
    { abortSignal: AbortSignal.timeout(BEDROCK_TIMEOUT_MS) },
  );
  return out.output?.message?.content?.find((block) => typeof block.text === 'string')?.text;
}
