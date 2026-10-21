// Dependency-free on purpose: shared/ sits outside each service's node_modules, so it may only
// import node: builtins. Structural types keep it compatible with APIGatewayProxyEventV2.
export interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function json(statusCode: number, body: unknown): HttpResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export const error = (statusCode: number, message: string): HttpResult => json(statusCode, { error: message });

/** Parses the JSON request body; `undefined` means missing or malformed. */
export function parseJsonBody(event: { body?: string; isBase64Encoded?: boolean }): unknown {
  if (!event.body) return undefined;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
