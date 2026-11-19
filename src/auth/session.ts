/** How a session authenticates a request. Memrise access tokens are Bearer tokens (G-2). */
import type { ApiRequest } from '../http/httpClient.js';

export interface Session {
  accessToken: string;
}

/** On-disk form of a session; `account` binds it to one username without storing the username. */
export interface StoredSession {
  version: 1;
  account: string;
  accessToken: string;
  createdAt: string;
}

export interface SessionStore {
  load(): Promise<Session | null>;
  save(session: Session): Promise<void>;
  clear(): Promise<void>;
}

/** Returns a copy of the request carrying the session's Bearer token; the input is left untouched. */
export function applySession(req: ApiRequest, session: Session): ApiRequest {
  return {
    ...req,
    headers: { ...req.headers, authorization: `Bearer ${session.accessToken}` },
  };
}
