// Android implementation; M6 adds audio.web.ts. While casting (M26, M50) the playback service's
// session plays on the receiver, so the same calls control it.
export * from '@lelap/audio';

/**
 * The web's media keys step through a list (M119). On Android ⏮/⏭ stay the skip by time and the
 * notification's overflow has the list, so there is nothing to set.
 */
export function setListKeys(
  keys: { previous: boolean; next: boolean; step: (forward: boolean) => void } | null,
): void {
  void keys;
}
