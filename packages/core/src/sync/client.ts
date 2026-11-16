/** Talks to a sync server. The server stores sealed messages it cannot read. */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type PulledMessage = { seq: number; device: string; data: string };

export class SyncError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type SyncClient = ReturnType<typeof createSyncClient>;

export function createSyncClient(fetcher: Fetch, baseUrl: string) {
  const base = baseUrl.replace(/\/$/, '');
  const call = async (path: string, init: RequestInit & { token?: string } = {}) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    const response = await fetcher(`${base}${path}`, { ...init, headers });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new SyncError(
        response.status,
        body?.error ?? `The sync server answered HTTP ${response.status}.`,
      );
    }
    return response;
  };

  return {
    async createGroup(groupId: string, authHash: string): Promise<void> {
      await call(`/v1/groups/${groupId}`, { method: 'PUT', body: JSON.stringify({ authHash }) });
    },
    async push(groupId: string, token: string, device: string, messages: string[]): Promise<void> {
      if (messages.length === 0) return;
      await call(`/v1/groups/${groupId}/messages`, {
        method: 'POST',
        token,
        body: JSON.stringify({ device, messages }),
      });
    },
    async pull(
      groupId: string,
      token: string,
      after: number,
      limit: number,
    ): Promise<{ messages: PulledMessage[]; last: number }> {
      const response = await call(`/v1/groups/${groupId}/messages?after=${after}&limit=${limit}`, {
        token,
      });
      return (await response.json()) as { messages: PulledMessage[]; last: number };
    },
    async leave(groupId: string, token: string): Promise<void> {
      await call(`/v1/groups/${groupId}`, { method: 'DELETE', token });
    },
    async putPairing(lookup: string, blob: string): Promise<void> {
      await call(`/v1/pairings/${lookup}`, { method: 'PUT', body: JSON.stringify({ blob }) });
    },
    /** The sealed group secret, once; the server deletes it as it answers. */
    async takePairing(lookup: string): Promise<string | null> {
      try {
        const response = await call(`/v1/pairings/${lookup}`, { method: 'POST' });
        return ((await response.json()) as { blob: string }).blob;
      } catch (error) {
        if (error instanceof SyncError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
