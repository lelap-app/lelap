import { z } from 'zod';

/**
 * Speaker groups the listener played on (M125), so the Cast sheet offers them as one tap the next
 * time. Ids are discovery's (a UPnP device's UDN, a Google Cast or FCast service name), which stay
 * the same across restarts; the first speaker leads. Names come from discovery when shown.
 */
export const CastGroupSchema = z.object({
  ids: z.array(z.string().min(1).max(500)).min(2).max(16),
});

export type CastGroup = z.infer<typeof CastGroupSchema>;

/** The groups kept, newest first. */
export const CAST_GROUPS_KEPT = 4;

/** The same speakers, in any order. */
function sameSpeakers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * [groups] with [ids] first. The same speakers played again move to the front, led by the speaker
 * that led this time; the oldest fall off past [CAST_GROUPS_KEPT]. One speaker is no group.
 */
export function rememberCastGroup(groups: CastGroup[], ids: string[]): CastGroup[] {
  const unique = [...new Set(ids)];
  if (unique.length < 2) return groups;
  const rest = groups.filter((g) => !sameSpeakers(g.ids, unique));
  return [{ ids: unique }, ...rest].slice(0, CAST_GROUPS_KEPT);
}

export function forgetCastGroup(groups: CastGroup[], ids: string[]): CastGroup[] {
  return groups.filter((g) => !sameSpeakers(g.ids, ids));
}

/**
 * The remembered groups that can play now: every speaker is on the network, and the group isn't
 * the one playing. A group with a speaker away is left out rather than played without it.
 */
export function castGroupsHere(
  groups: CastGroup[],
  found: ReadonlySet<string>,
  playing: string[] | null,
): CastGroup[] {
  return groups.filter(
    (g) =>
      g.ids.every((id) => found.has(id)) && (playing === null || !sameSpeakers(g.ids, playing)),
  );
}
