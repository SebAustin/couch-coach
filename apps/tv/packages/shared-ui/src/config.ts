import { ClientConfig } from './vendor/protocol';
import { clientConfig, isPlaceholderConfig } from './config.generated';

/** Validated runtime config (generated from infra/client-config.json by scripts/sync-shared.mjs). */
export const config: ClientConfig = ClientConfig.parse(clientConfig);
export { isPlaceholderConfig };
