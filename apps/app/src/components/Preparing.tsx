import {
  type FoundStream,
  PREPARING_WAIT_MS,
  probeStream,
  type ProbeFetcher,
  type StreamState,
  streamProbeUrl,
} from '@lelap/core';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { showAlert } from '../dialog';
import { formatClock } from '../format';
import { t } from '../i18n';
import { TextButton } from './TextButton';

const probeFetch: ProbeFetcher = (url, init) => fetch(url, init);

/**
 * Whether a stream's audio is there yet (M152). Only a stream the add-on marks `preparing` is
 * asked: a server that ignores the Range header sends the whole file, and the phone's `fetch`
 * reads it all. Audio with headers (an add-on inside the app) or off the web counts as ready.
 */
export async function streamState(found: FoundStream): Promise<StreamState> {
  const url = streamProbeUrl(found.stream);
  if (!url || found.stream.headers || found.stream.availability !== 'preparing')
    return { state: 'ready' };
  return probeStream(probeFetch, url, Date.now());
}

/** Says a stream won't come, in the add-on's words when it gave short ones. */
export function showGone(state: Extract<StreamState, { state: 'gone' }>) {
  showAlert(t('Cannot play'), state.message ?? t('The source no longer has this book.'));
}

const stillPreparing = () =>
  showAlert(
    t('Still preparing'),
    t('The source is still getting this book ready. Try again later, or download it when ready.'),
  );

type Waiting = { found: FoundStream; until: number; nextAt: number };

/**
 * Waits for a preparing stream while the page is open: asks again when the add-on says, for up
 * to 10 minutes, then plays it. `wait` starts it; Cancel or leaving the page ends it.
 */
export function usePreparing(onReady: (found: FoundStream) => void) {
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [now, setNow] = useState(Date.now());
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    if (!waiting) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [waiting]);

  // Only due or not matters, so the clock's ticks don't cancel a probe on its way.
  const due = waiting !== null && now >= waiting.nextAt;
  useEffect(() => {
    if (!waiting || !due) return;
    let live = true;
    void streamState(waiting.found).then((state) => {
      if (!live) return;
      if (state.state === 'ready') {
        setWaiting(null);
        ready.current(waiting.found);
      } else if (state.state === 'gone') {
        setWaiting(null);
        showGone(state);
      } else {
        const nextAt = Date.now() + state.seconds * 1000;
        if (nextAt > waiting.until) {
          setWaiting(null);
          stillPreparing();
        } else setWaiting({ ...waiting, nextAt });
      }
    });
    return () => {
      live = false;
    };
  }, [waiting, due]);

  return {
    waiting,
    secondsLeft: waiting ? Math.max(0, Math.ceil((waiting.nextAt - now) / 1000)) : 0,
    wait: (found: FoundStream, seconds: number) => {
      const start = Date.now();
      if (seconds * 1000 > PREPARING_WAIT_MS) return stillPreparing();
      setNow(start);
      setWaiting({ found, until: start + PREPARING_WAIT_MS, nextAt: start + seconds * 1000 });
    },
    cancel: () => setWaiting(null),
  };
}

/** Under the Play button while a stream is preparing. */
export function PreparingPanel({
  secondsLeft,
  canDownload,
  onDownload,
  onCancel,
}: {
  secondsLeft: number;
  canDownload: boolean;
  onDownload: () => void;
  onCancel: () => void;
}) {
  return (
    <View
      className="gap-1 rounded-2xl bg-raised p-4"
      accessibilityLiveRegion="polite"
      aria-live="polite"
    >
      <Text className="text-base font-semibold text-paper">{t('Preparing…')}</Text>
      <Text className="text-sm leading-5 text-soft">
        {t('The source is getting this book ready. Trying again in {time}.', {
          time: formatClock(secondsLeft * 1000),
        })}
      </Text>
      <View className="flex-row flex-wrap gap-4">
        {canDownload && <TextButton strong text={t('Download when ready')} onPress={onDownload} />}
        <TextButton text={t('Cancel')} onPress={onCancel} />
      </View>
    </View>
  );
}
