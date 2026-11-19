// The bytes a media element streams, passed on by the service worker (`web/sw.js`, M122), so skip
// silence decodes them instead of fetching the file a second time. Kept in memory around the
// place only, never stored. Without the service worker (a dev build, a browser that doesn't run
// it for media), nothing arrives and skip silence reads with range requests as before.

type Piece = { start: number; bytes: Uint8Array };
type Teed = { pieces: Piece[]; size: number | null; held: number; arrived: number };

const files = new Map<string, Teed>();
/** Kept per file at most; what lies furthest ahead goes first. */
const LIMIT = 32 * 1024 * 1024;

/** Bytes skip silence took from the stream, and bytes it had to fetch itself (for diagnostics). */
export const teeCounts = { shared: 0, own: 0 };

const absolute = (url: string): string => {
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
};

let listening = false;
function listen(): void {
  if (listening || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  listening = true;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as {
      type?: string;
      url?: string;
      start?: number;
      bytes?: ArrayBuffer;
      size?: number | null;
    } | null;
    if (data?.type !== 'lelap-bytes' || !data.url || !data.bytes) return;
    const file = files.get(data.url);
    if (!file || typeof data.start !== 'number') return;
    if (data.size) file.size = data.size;
    file.pieces.push({ start: data.start, bytes: new Uint8Array(data.bytes) });
    file.pieces.sort((a, b) => a.start - b.start);
    file.held += data.bytes.byteLength;
    file.arrived = Date.now();
    while (file.held > LIMIT && file.pieces.length > 1) {
      const dropped = file.pieces.pop();
      file.held -= dropped?.bytes.length ?? 0;
    }
  });
}

/**
 * Asks the service worker to pass on what the element fetches from `url`. Resolves once it has
 * the request, or after 300 ms; without a service worker, at once.
 */
export async function watch(url: string): Promise<void> {
  const worker = typeof navigator === 'undefined' ? null : navigator.serviceWorker?.controller;
  if (!worker) return;
  listen();
  const key = absolute(url);
  if (!files.has(key)) {
    // One file at a time: the element plays one.
    files.clear();
    files.set(key, { pieces: [], size: null, held: 0, arrived: 0 });
  }
  const channel = new MessageChannel();
  const heard = new Promise<void>((resolve) => {
    channel.port1.onmessage = () => resolve();
  });
  worker.postMessage({ type: 'lelap-tee', url: key }, [channel.port2]);
  await Promise.race([heard, new Promise<void>((resolve) => setTimeout(resolve, 300))]);
  channel.port1.close();
}

/**
 * Whether bytes of `url` came through in the last 1.5 s: then a miss may still arrive, so it is
 * worth a wait. An element that has read all it wants sends nothing more.
 */
export function flowing(url: string): boolean {
  const file = files.get(absolute(url));
  return !!file && Date.now() - file.arrived < 1500;
}

export function size(url: string): number | null {
  return files.get(absolute(url))?.size ?? null;
}

/** Bytes `from` up to `to` if the element has fetched all of them; else null. */
export function read(url: string, from: number, to: number): Uint8Array | null {
  const file = files.get(absolute(url));
  if (!file || to <= from) return null;
  const end = file.size ? Math.min(to, file.size) : to;
  const out = new Uint8Array(end - from);
  let at = from;
  for (const piece of file.pieces) {
    const pieceEnd = piece.start + piece.bytes.length;
    if (piece.start > at) break;
    if (pieceEnd <= at) continue;
    const take = Math.min(pieceEnd, end) - at;
    out.set(piece.bytes.subarray(at - piece.start, at - piece.start + take), at - from);
    at += take;
    if (at >= end) return out;
  }
  return null;
}

/**
 * The part of `from` up to `to` the element has fetched without a gap, the largest one; null
 * when it has fetched none of it. After a seek the element reads from the new place on, so what
 * lies just before it never comes.
 */
export function covered(
  url: string,
  from: number,
  to: number,
): { from: number; to: number } | null {
  const file = files.get(absolute(url));
  if (!file) return null;
  const end = file.size ? Math.min(to, file.size) : to;
  let best: { from: number; to: number } | null = null;
  const consider = (start: number, stop: number) => {
    const a = Math.max(from, start);
    const b = Math.min(end, stop);
    if (b > a && (!best || b - a > best.to - best.from)) best = { from: a, to: b };
  };
  // Runs of pieces without a gap, in order of their start.
  let runStart = -1;
  let runEnd = -1;
  for (const piece of file.pieces) {
    if (piece.start > runEnd) {
      if (runStart >= 0) consider(runStart, runEnd);
      runStart = piece.start;
    }
    runEnd = Math.max(runEnd, piece.start + piece.bytes.length);
  }
  if (runStart >= 0) consider(runStart, runEnd);
  return best;
}

/** Lets go of the bytes before `byte`: the place has moved past them. */
export function forget(url: string, byte: number): void {
  const file = files.get(absolute(url));
  if (!file) return;
  const kept = file.pieces.filter((p) => p.start + p.bytes.length > byte);
  for (const piece of file.pieces) if (!kept.includes(piece)) file.held -= piece.bytes.length;
  file.pieces = kept;
}
