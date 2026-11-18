import { describe, expect, it } from 'vitest';

import { clipStep, type Clip } from './clip';

const soundbite: Clip = { bookId: 'garden-hour-12', startMs: 60_000, endMs: 90_000 };

describe('a clip', () => {
  it('waits for its end, faster at a higher speed', () => {
    expect(clipStep(soundbite, 'garden-hour-12', 60_000, 1)).toEqual({ kind: 'wait', ms: 30_000 });
    expect(clipStep(soundbite, 'garden-hour-12', 80_000, 2)).toEqual({ kind: 'wait', ms: 5_000 });
  });

  it('stops at its end, or a little past it', () => {
    expect(clipStep(soundbite, 'garden-hour-12', 89_950, 1)).toEqual({ kind: 'stop' });
    expect(clipStep(soundbite, 'garden-hour-12', 92_000, 1)).toEqual({ kind: 'stop' });
  });

  it('is over when the listener plays another book or seeks away', () => {
    expect(clipStep(soundbite, 'other', 70_000, 1)).toEqual({ kind: 'leave' });
    expect(clipStep(soundbite, null, 70_000, 1)).toEqual({ kind: 'leave' });
    expect(clipStep(soundbite, 'garden-hour-12', 10_000, 1)).toEqual({ kind: 'leave' });
    expect(clipStep(soundbite, 'garden-hour-12', 300_000, 1)).toEqual({ kind: 'leave' });
  });

  it('ignores the old place while its own seek is on the way', () => {
    expect(clipStep(soundbite, 'garden-hour-12', 10_000, 1, false)).toEqual({ kind: 'hold' });
    expect(clipStep(soundbite, 'other', 10_000, 1, false)).toEqual({ kind: 'hold' });
    // The old place sat at the clip's end: it must not stop the clip before it starts.
    expect(clipStep(soundbite, 'garden-hour-12', 90_000, 1, false)).toEqual({ kind: 'hold' });
    expect(clipStep(soundbite, 'garden-hour-12', 60_500, 1, false)).toEqual({
      kind: 'wait',
      ms: 29_500,
    });
  });
});
