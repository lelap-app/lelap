import { clipStep, getBook, toBookPosition, type Clip } from '@lelap/core';
import { useEffect } from 'react';

import { db } from './db';
import * as audio from './platform/audio';
import { playAt, usePlayerState } from './player';
import { profileId } from './profile';

// A seek takes a moment to show in the player's state; until then an old place can't end a clip.
const SETTLE_MS = 2_000;

type Files = Parameters<typeof toBookPosition>[0];
type PlayingClip = Clip & { since: number; files: Files };

let clip: PlayingClip | null = null;

/**
 * Plays a stretch of a book and pauses at its end (M88): a soundbite, or a shared clip. Seeking
 * out of it or playing another book lets playback go on as usual.
 */
export async function playClip(bookId: string, startMs: number, endMs: number): Promise<void> {
  clip = null;
  await playAt(bookId, startMs);
  const files = getBook(db, profileId, bookId)?.files;
  if (files && endMs > startMs) clip = { bookId, startMs, endMs, since: Date.now(), files };
}

function stop(current: PlayingClip) {
  if (clip !== current) return;
  clip = null;
  void audio.pause().catch(() => {});
}

/** Pauses a playing clip at its end. Mounted once, beside the player. */
export function ClipStop() {
  const state = usePlayerState();
  useEffect(() => {
    const current = clip;
    if (!current || !state.playing) return;
    const position = toBookPosition(current.files, state.fileLocation ?? '', state.positionMs);
    const settled = Date.now() - current.since > SETTLE_MS;
    const step = clipStep(current, state.bookId, position, state.speed, settled);
    if (step.kind === 'leave') clip = null;
    if (step.kind === 'stop') stop(current);
    if (step.kind !== 'wait') return;
    // Between the player's once-a-second updates, a timer meets the end on time.
    const timer = setTimeout(() => stop(current), step.ms);
    return () => clearTimeout(timer);
  }, [state]);
  return null;
}
