/** Talks to a sync server. The server stores sealed messages it cannot read. */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** `at` is when the server stored it; servers before M52 leave it out. */
export type PulledMessage = { seq: number; device: string; data: string; at?: number };

export class SyncError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** With 410: the messages up to here are in the group's snapshot now. */
    readonly snapshot?: number,
  ) {
    super(message);
  }
}

export type GroupInfo = {
  bytes: number;
  snapshot: { covers: number; parts: number } | null;
  /** Messages stored before the `before` asked for. */
  older: { messages: number; bytes: number };
};

export type SnapshotPage = { covers: number; parts: number; data: string[] };

export type SyncClient = ReturnType<typeof createSyncClient>;

export function createSyncClient(fetcher: Fetch, baseUrl: string) {
  const base = baseUrl.replace(/\/$/, '');
  const call = async (path: string, init: RequestInit & { token?: string } = {}) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    const response = await fetcher(`${base}${path}`, { ...init, headers });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        snapshot?: unknown;
      } | null;
      throw new SyncError(
        response.status,
        body?.error ?? `The sync server answered HTTP ${response.status}.`,
        ...(typeof body?.snapshot === 'number' ? [body.snapshot] : []),
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
    /** Sizes, for deciding whether to write a snapshot. */
    async info(groupId: string, token: string, before: number): Promise<GroupInfo> {
      const response = await call(`/v1/groups/${groupId}?before=${before}`, { token });
      return (await response.json()) as GroupInfo;
    },
    /** A page of the group's snapshot parts, or null when it has none. */
    async snapshot(
      groupId: string,
      token: string,
      from: number,
      limit: number,
    ): Promise<SnapshotPage | null> {
      try {
        const response = await call(`/v1/groups/${groupId}/snapshot?from=${from}&limit=${limit}`, {
          token,
        });
        return (await response.json()) as SnapshotPage;
      } catch (error) {
        if (error instanceof SyncError && error.status === 404) return null;
        throw error;
      }
    },
    async putSnapshotParts(
      groupId: string,
      token: string,
      covers: number,
      from: number,
      parts: string[],
    ): Promise<void> {
      await call(`/v1/groups/${groupId}/snapshot/parts`, {
        method: 'POST',
        token,
        body: JSON.stringify({ covers, from, parts }),
      });
    },
    /** False when another device wrote a newer snapshot first. */
    async commitSnapshot(
      groupId: string,
      token: string,
      covers: number,
      parts: number,
    ): Promise<boolean> {
      try {
        await call(`/v1/groups/${groupId}/snapshot`, {
          method: 'POST',
          token,
          body: JSON.stringify({ covers, parts }),
        });
        return true;
      } catch (error) {
        if (error instanceof SyncError && error.status === 409) return false;
        throw error;
      }
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
