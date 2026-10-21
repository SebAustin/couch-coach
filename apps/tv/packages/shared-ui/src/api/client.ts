import { z } from 'zod';
import { Member, SessionResponse, type ClientConfig } from '../vendor/protocol';

export type ApiErrorKind = 'network' | 'http' | 'schema';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Api {
  getMembers(): Promise<Member[]>;
  createMember(name: string): Promise<Member>;
  createSession(memberId: string): Promise<SessionResponse>;
}

const MembersResponse = z.object({ members: z.array(Member) });
const DEFAULT_TIMEOUT_MS = 8000;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Typed client for the Session/Members HTTP API (docs/CONTRACTS.md). All responses are zod-validated. */
export function createApi(
  config: Pick<ClientConfig, 'apiBaseUrl'>,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Api {
  const base = config.apiBaseUrl.replace(/\/+$/, '');

  async function request<T>(path: string, schema: z.ZodType<T>, init?: { method: string; body?: unknown }): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: init?.method ?? 'GET',
        headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      throw new ApiError(aborted ? `Request timed out after ${timeoutMs} ms` : 'Network request failed', 'network');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new ApiError(`Server returned ${response.status}`, 'http', response.status);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ApiError('Server sent invalid JSON', 'schema', response.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ApiError('Server response did not match the contract', 'schema', response.status);
    return parsed.data;
  }

  return {
    getMembers: async () => (await request('/members', MembersResponse)).members,
    createMember: (name) => request('/members', Member, { method: 'POST', body: { name: name.trim() } }),
    createSession: (memberId) => request('/session', SessionResponse, { method: 'POST', body: { memberId } }),
  };
}

/** The URL the QR encodes: the phone URL plus the Member id (`&m=<memberId>`). */
export function pairingUrl(phoneUrl: string, memberId: string): string {
  const separator = phoneUrl.includes('?') ? '&' : '?';
  return `${phoneUrl}${separator}m=${encodeURIComponent(memberId)}`;
}

/** Short, human-readable form of the phone URL for the hint line (host only; the token stays in the QR). */
export function shortUrlHint(phoneUrl: string): string {
  try {
    return new URL(phoneUrl).host;
  } catch {
    return phoneUrl;
  }
}
