export type IdGenerator = () => string;

/** RFC 9562 UUIDv7: 48-bit millisecond timestamp, then 74 random bits. Sorts by creation time. */
export function uuidv7(nowMs: number, random: Uint8Array): string {
  const bytes = new Uint8Array(16);
  let time = nowMs;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes.set(random.subarray(0, 10), 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createIdGenerator(
  randomBytes: (n: number) => Uint8Array,
  clock: () => number = Date.now,
): IdGenerator {
  return () => uuidv7(clock(), randomBytes(10));
}
