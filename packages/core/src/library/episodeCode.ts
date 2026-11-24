const CODE = /\bS(\d{1,3})\s*E(\d{1,4})\b|\bE(?:p(?:isode)?)?\.?\s*(\d{1,4})\b/i;

/** `S04E01` → season 4, episode 1; `E12` or `Episode 12` → episode 12. */
export function episodeCode(name: string): { season: number | null; number: number } | null {
  const m = CODE.exec(name);
  if (!m) return null;
  if (m[1] && m[2]) return { season: Number(m[1]), number: Number(m[2]) };
  return m[3] ? { season: null, number: Number(m[3]) } : null;
}
