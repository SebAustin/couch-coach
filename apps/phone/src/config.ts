import { ClientConfig } from '@couch-coach/protocol';

/** Fetch and validate `config.json` (written by CDK next to the app; copied from infra/ in dev). */
export async function loadClientConfig(url = 'config.json'): Promise<ClientConfig> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`config.json returned HTTP ${res.status}`);
  const parsed = ClientConfig.safeParse(await res.json());
  if (!parsed.success) throw new Error('config.json is not a valid ClientConfig');
  return parsed.data;
}
