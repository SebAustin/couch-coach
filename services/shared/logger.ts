export type LogFields = Record<string, unknown> & { sessionId?: string };

/**
 * Structured log keyed by sessionId so CloudWatch Logs Insights can follow a Session (`message.sessionId`).
 * Logs an object, not a string: with the Lambda JSON log format a string would be double-encoded.
 */
export function log(level: 'info' | 'warn' | 'error', msg: string, fields: LogFields = {}): void {
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)({ msg, ...fields });
}

export const errorFields = (err: unknown): Record<string, unknown> =>
  err instanceof Error ? { errorName: err.name, errorMessage: err.message } : { errorMessage: String(err) };
