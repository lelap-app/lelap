/** The Cache API's job in memory: responses kept for their `max-age`. */
export function memoryCache(maxEntries = 2_000) {
  const entries = new Map<string, { body: ArrayBuffer; init: ResponseInit; expires: number }>();
  return {
    /** Responses held, expired ones included until they are next asked for or pushed out. */
    get size(): number {
      return entries.size;
    },
    async match(key: string): Promise<Response | undefined> {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.expires < Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return new Response(hit.body.slice(0), hit.init);
    },
    async put(key: string, response: Response): Promise<void> {
      const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1];
      if (!maxAge) return;
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value ?? '');
      entries.set(key, {
        body: await response.arrayBuffer(),
        init: { status: response.status, headers: Object.fromEntries(response.headers) },
        expires: Date.now() + Number(maxAge) * 1000,
      });
    },
  };
}
