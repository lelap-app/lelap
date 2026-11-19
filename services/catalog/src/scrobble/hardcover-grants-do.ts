import { AddonError } from '@lelap/sdk';

import { type Env, userAgent } from '../app';
import {
  createGrant,
  GRANT_LIFETIME_MS,
  grantAccess,
  type Grants,
  type GrantStore,
} from './hardcover-grants';
import { hardcoverOAuth } from './hardcover-oauth';

// Hardcover sign-ins on Workers (M92): a Durable Object per grant, so its tokens have one home
// and one renewal runs at a time wherever the requests come from. It keeps one sealed record
// and forgets it once unused for longer than a refresh token lasts.

type Call =
  { op: 'put'; sealed: string } | { op: 'access'; id: string; key: string; refused?: string };

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

export class HardcoverGrants implements DurableObject {
  private readonly store: GrantStore;
  private readonly access: Grants['access'] | null;

  constructor(
    private readonly state: DurableObjectState,
    env: Env,
  ) {
    const storage = state.storage;
    this.store = {
      get: async () => (await storage.get<string>('tokens')) ?? null,
      put: async (_id, sealed) => {
        await storage.put('tokens', sealed);
        await storage.setAlarm(Date.now() + GRANT_LIFETIME_MS);
      },
      delete: async () => {
        await storage.deleteAlarm();
        await storage.deleteAll();
      },
    };
    const oauth = hardcoverOAuth((url, init) => fetch(url, init), {
      clientId: env.HARDCOVER_CLIENT_ID,
      clientSecret: env.HARDCOVER_CLIENT_SECRET,
      userAgent: userAgent(env),
    });
    this.access = oauth ? grantAccess(this.store, oauth.refresh) : null;
  }

  async fetch(request: Request): Promise<Response> {
    const call = (await request.json()) as Call;
    if (call.op === 'put') {
      await this.store.put('', call.sealed);
      return json({ ok: true });
    }
    try {
      if (!this.access) throw new AddonError(503, 'Hardcover sign-in is off on this server');
      return json({ access: await this.access({ id: call.id, key: call.key }, call.refused) });
    } catch (error) {
      // Only the message crosses back; it never holds a token.
      if (error instanceof AddonError) return json({ status: error.status, error: error.message });
      throw error;
    }
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

/** The worker's side: each grant's calls go to its own object. */
export function durableGrants(namespace: DurableObjectNamespace): Grants {
  const call = async (id: string, body: Call) => {
    const stub = namespace.get(namespace.idFromName(id));
    return stub.fetch('https://grant.internal/', { method: 'POST', body: JSON.stringify(body) });
  };
  const store: GrantStore = {
    get: async () => null,
    put: async (id, sealed) => {
      const response = await call(id, { op: 'put', sealed });
      if (!response.ok) throw new Error('Could not keep the Hardcover sign-in');
    },
    delete: async () => undefined,
  };
  return {
    create: (tokens) => createGrant(store, tokens),
    access: async (ref, refused) => {
      const response = await call(ref.id, {
        op: 'access',
        id: ref.id,
        key: ref.key,
        ...(refused ? { refused } : {}),
      });
      const body = (await response.json().catch(() => null)) as {
        access?: string;
        status?: number;
        error?: string;
      } | null;
      if (typeof body?.access === 'string') return body.access;
      throw new AddonError(body?.status ?? 502, body?.error ?? 'Hardcover sign-in failed');
    },
  };
}
