/** US cross-region inference profiles route to these Regions (checked with `aws bedrock get-inference-profile`). */
const US_PROFILE_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2'] as const;

/**
 * Converse through a `us.` inference profile needs bedrock:InvokeModel on the profile itself AND on the
 * underlying foundation model in every Region the profile can route to. Nothing else is granted.
 */
export function bedrockInvokeArns(profileId: string, account: string, homeRegion: string): string[] {
  if (!profileId.startsWith('us.')) {
    throw new Error(`Unsupported inference profile "${profileId}": only us.* system profiles are mapped to foundation-model ARNs`);
  }
  const foundationModelId = profileId.slice('us.'.length);
  return [
    `arn:aws:bedrock:${homeRegion}:${account}:inference-profile/${profileId}`,
    ...US_PROFILE_REGIONS.map((r) => `arn:aws:bedrock:${r}::foundation-model/${foundationModelId}`),
  ];
}
