/**
 * A small client for the Lege API. Copy it into your own frontend (React, Vue, Svelte, whatever).
 *
 *   import { createClient } from './lege-client.mjs';
 *   const api = createClient({ baseUrl: 'https://api.lege.al' });
 *   const { user } = await api.login('reception@lege.al', 'password', 'receptionist');
 *   if (api.isManager()) { ... } else { ... }
 *   const state = await api.get('/state');
 *
 * The token is stored in sessionStorage (cleared when the tab closes). If you don't want it to
 * survive a refresh at all, pass { storage: null }: it then lives only in memory and the person
 * signs in again after a refresh.
 */
export class ApiError extends Error {
  constructor(status, message) { super(message); this.name = 'ApiError'; this.status = status; }
}

export function createClient({ baseUrl, storage = globalThis.sessionStorage ?? null, onUnauthorized } = {}) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const KEY = 'lege_session';
  let session = null;                       // { token, user }
  try { session = storage ? JSON.parse(storage.getItem(KEY) || 'null') : null; } catch { session = null; }

  const persist = () => { try { if (storage) session ? storage.setItem(KEY, JSON.stringify(session)) : storage.removeItem(KEY); } catch { /* ignore */ } };

  async function request(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    const res = await fetch(`${base}/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      session = null; persist();
      if (onUnauthorized) onUnauthorized();
    }
    if (!res.ok) throw new ApiError(res.status, data?.error || 'Something went wrong. Please try again.');
    return data;
  }

  return {
    request,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),

    /**
     * Sign in with email, password, and the role the person picked at the login screen
     * ("manager" or "receptionist"). The role must match the account's actual role, or the
     * server rejects the sign-in with a 403 and a message like "This is a Manager account.
     * Select Manager to sign in." — this is checked only after the password verifies, so it
     * never reveals whether an account exists.
     * Returns { user: { id, name, email, role } }.
     */
    async login(email, password, role) {
      const data = await request('POST', '/auth/login', { email, password, role });
      session = { token: data.token, user: data.user };
      persist();
      return { user: data.user };
    },
    logout() { session = null; persist(); },

    get user() { return session?.user ?? null; },
    get isLoggedIn() { return !!session?.token; },
    isManager() { return session?.user?.role === 'manager'; },
    isReceptionist() { return session?.user?.role === 'receptionist'; },
  };
}
