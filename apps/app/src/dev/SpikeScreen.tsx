import * as audio from '../platform/audio';
import type { PlayerState } from '@lelap/audio';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { fetchLibriVoxBook } from './librivox';

const DEFAULT_BOOK_ID = '254';
const SPEEDS = [0.8, 1, 1.25, 1.5, 2, 3];
const SLEEP_TIMER_MINUTES = [1, 5, 15];

const INITIAL_STATE: PlayerState = {
  connected: false,
  playing: false,
  buffering: false,
  ended: false,
  bookId: null,
  fileLocation: null,
  bookTitle: null,
  partTitle: null,
  partIndex: -1,
  partCount: 0,
  positionMs: 0,
  durationMs: 0,
  speed: 1,
  duckOnInterruption: true,
  waitingForCall: false,
  sleepTimerRemainingMs: null,
  sleepTimerMode: null,
  error: null,
};

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function Button({
  label,
  onPress,
  active = false,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.button, active && styles.buttonActive]}>
      <Text style={[styles.buttonText, active && styles.buttonTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function SpikeScreen() {
  const [bookId, setBookId] = useState(DEFAULT_BOOK_ID);
  const [state, setState] = useState<PlayerState>(INITIAL_STATE);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const subscription = audio.addStateListener(setState);
    // Picks up a book that kept playing while the app was closed.
    audio.getState().then(setState, (error: unknown) => setMessage(String(error)));
    return () => subscription.remove();
  }, []);

  const run = (action: Promise<void>) => {
    action.catch((error: unknown) => setMessage(String(error)));
  };

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const book = await fetchLibriVoxBook(bookId.trim());
      await audio.load(
        {
          bookId: `librivox-${bookId.trim()}`,
          title: book.title,
          author: null,
          coverUri: null,
          files: book.parts.map((p) => ({
            uri: p.url,
            location: p.url,
            title: p.title,
            durationMs: 0,
          })),
          chapters: [],
          startIndex: 0,
          startPositionMs: 0,
          speed: 1,
          pausedAt: null,
        },
        true,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const loaded = state.partIndex >= 0;
  const error = message ?? state.error;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Lelap audio spike</Text>

      <View style={styles.row}>
        <TextInput
          value={bookId}
          onChangeText={setBookId}
          keyboardType="number-pad"
          placeholder="LibriVox book ID"
          placeholderTextColor="#777"
          style={styles.input}
        />
        <Button label={loading ? 'Loading…' : 'Load'} onPress={() => void load()} />
      </View>

      <Text style={styles.title}>{state.bookTitle ?? 'No book loaded'}</Text>
      {loaded && (
        <Text style={styles.text}>
          Part {state.partIndex + 1} / {state.partCount}: {state.partTitle}
        </Text>
      )}
      <Text style={styles.text}>
        {formatTime(state.positionMs)} / {formatTime(state.durationMs)}
        {state.buffering ? '  buffering…' : ''}
        {state.waitingForCall ? '  starts when the call ends' : ''}
      </Text>

      <View style={styles.row}>
        <Button label="⏮ Part" onPress={() => run(audio.skipToPart(state.partIndex - 1))} />
        <Button label="−30 s" onPress={() => run(audio.seekBy(-30_000))} />
        <Button
          label={state.playing ? 'Pause' : 'Play'}
          onPress={() => run(state.playing ? audio.pause() : audio.play())}
          active
        />
        <Button label="+30 s" onPress={() => run(audio.seekBy(30_000))} />
        <Button label="Part ⏭" onPress={() => run(audio.skipToPart(state.partIndex + 1))} />
      </View>

      <Text style={styles.label}>Speed</Text>
      <View style={styles.row}>
        {SPEEDS.map((speed) => (
          <Button
            key={speed}
            label={`${speed}×`}
            active={Math.abs(state.speed - speed) < 0.01}
            onPress={() => run(audio.setSpeed(speed))}
          />
        ))}
      </View>

      <View style={[styles.row, styles.between]}>
        <Text style={styles.text}>Duck on interruption (calls)</Text>
        <Switch
          value={state.duckOnInterruption}
          onValueChange={(enabled) =>
            run(
              audio.setSettings({
                duckOnInterruption: enabled,
                skipIntervalMs: 30_000,
                smartRewind: true,
                mono: false,
                voiceEq: false,
                volumeBoost: false,
              }),
            )
          }
        />
      </View>

      <Text style={styles.label}>
        Sleep timer
        {state.sleepTimerRemainingMs === null
          ? ''
          : `: ${formatTime(state.sleepTimerRemainingMs)} left`}
      </Text>
      <View style={styles.row}>
        {SLEEP_TIMER_MINUTES.map((minutes) => (
          <Button
            key={minutes}
            label={`${minutes} min`}
            onPress={() => run(audio.startSleepTimer(minutes))}
          />
        ))}
        <Button label="Cancel" onPress={() => run(audio.cancelSleepTimer())} />
      </View>

      {error !== null && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0d0e11' },
  content: { padding: 20, paddingTop: 56, gap: 14 },
  heading: { color: '#f4f1ea', fontSize: 22, fontWeight: '600' },
  title: { color: '#f4f1ea', fontSize: 18 },
  text: { color: '#c9c5bc', fontSize: 15 },
  label: { color: '#8d8a83', fontSize: 13, textTransform: 'uppercase', marginTop: 8 },
  error: { color: '#ff8a7a', fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  between: { justifyContent: 'space-between' },
  input: {
    flex: 1,
    minWidth: 120,
    borderWidth: 1,
    borderColor: '#33353b',
    borderRadius: 8,
    color: '#f4f1ea',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  button: {
    borderWidth: 1,
    borderColor: '#33353b',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buttonActive: { backgroundColor: '#f5b041', borderColor: '#f5b041' },
  buttonText: { color: '#f4f1ea', fontSize: 15 },
  buttonTextActive: { color: '#1a1305', fontWeight: '600' },
});
