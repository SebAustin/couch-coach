/** Reads the HMAC key once per execution environment. `fetchSecret` wraps Secrets Manager (see each service). */
export function createSecretReader(fetchSecret: (secretArn: string) => Promise<string | undefined>) {
  const cache = new Map<string, string>();
  return async function getSecretString(secretArn: string): Promise<string> {
    const hit = cache.get(secretArn);
    if (hit) return hit;
    const value = await fetchSecret(secretArn);
    if (!value) throw new Error('HMAC secret has no SecretString');
    cache.set(secretArn, value);
    return value;
  };
}
