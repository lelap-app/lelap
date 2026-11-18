// Mono, voice boost (EQ and gentle compression) and volume boost for the web player, with Web
// Audio: as in the Android service's SoundChain. Only audio.web.ts imports this. Skip silence and
// even loudness (M84) are Android only.
//
// An element routed through Web Audio stays routed, and a source without CORS headers then plays
// as silence. So the player routes an element only for sources Web Audio may read (downloads,
// hosts that send CORS headers) and gives other sources a plain element without the effects.

export type SoundSettings = { mono: boolean; voiceEq: boolean; volumeBoost: boolean };

type Graph = {
  context: AudioContext;
  dry: GainNode;
  mono: GainNode;
  highPass: BiquadFilterNode;
  presence: BiquadFilterNode;
  voice: DynamicsCompressorNode;
  boost: GainNode;
  limiter: DynamicsCompressorNode;
};

// Switches glide over about 50 ms, like on Android, so nothing clicks.
const GLIDE_S = 0.015;
const BOOST_GAIN = 2;
const LIMIT_DB = -1.5;
const LIMIT_RATIO = 20;
// The compressor adds make-up gain of its own (Web Audio spec: (1 / full-range gain) ^ 0.6); the
// boost stage takes it back off, so below the threshold the level stays where it was.
const MAKEUP_TRIM = 10 ** ((0.6 * (LIMIT_DB - LIMIT_DB / LIMIT_RATIO)) / 20);
// Voice boost's compressor, as on Android: 3:1 above -24 dB, then +6 dB. Web Audio adds make-up
// gain of its own, 0.6 of what the curve takes off at full scale; the boost stage trims it to 6 dB.
const VOICE_THRESHOLD_DB = -24;
const VOICE_RATIO = 3;
const VOICE_MAKEUP_DB = 6;
const VOICE_TRIM =
  10 ** ((VOICE_MAKEUP_DB - 0.6 * -VOICE_THRESHOLD_DB * (1 - 1 / VOICE_RATIO)) / 20);
// Web Audio reads a high-pass Q in dB: 1/√2, the flattest response, is -3.01 dB.
const BUTTERWORTH_Q_DB = -3.01;

const graphs = new WeakMap<HTMLMediaElement, Graph>();
const readable = new Map<string, Promise<boolean>>();

export const soundOn = (s: SoundSettings): boolean => s.mono || s.voiceEq || s.volumeBoost;

export const isRouted = (element: HTMLMediaElement): boolean => graphs.has(element);

/** Whether Web Audio may read this source: same origin, a blob, or a host that allows CORS. */
export function canRoute(src: string): Promise<boolean> {
  if (typeof AudioContext === 'undefined') return Promise.resolve(false);
  let origin: string;
  try {
    const url = new URL(src, location.href);
    if (url.protocol === 'blob:' || url.origin === location.origin) return Promise.resolve(true);
    origin = url.origin;
  } catch {
    return Promise.resolve(false);
  }
  // One small request straight to the audio host, once per host.
  let answer = readable.get(origin);
  if (!answer) {
    answer = fetch(src, { mode: 'cors', headers: { Range: 'bytes=0-0' } })
      .then(async (response) => {
        await response.body?.cancel();
        return response.ok;
      })
      .catch(() => false);
    readable.set(origin, answer);
  }
  return answer;
}

/** Routes the element through the effects. Set `crossOrigin` before its source. */
export function route(element: HTMLMediaElement, settings: SoundSettings): void {
  if (graphs.has(element)) return;
  const context = new AudioContext();
  const source = context.createMediaElementSource(element);
  const dry = context.createGain();
  // A one-channel node downmixes both channels; the merger puts that mix in both ears.
  const mono = new GainNode(context, {
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  const merger = context.createChannelMerger(2);
  const highPass = new BiquadFilterNode(context, { type: 'highpass', Q: BUTTERWORTH_Q_DB });
  const presence = new BiquadFilterNode(context, { type: 'peaking', frequency: 3000, Q: 0.9 });
  const voice = new DynamicsCompressorNode(context, { knee: 0, attack: 0.005, release: 0.15 });
  const boost = context.createGain();
  const limiter = new DynamicsCompressorNode(context, {
    knee: 0,
    attack: 0.001,
    release: 0.15,
  });
  source.connect(dry).connect(highPass);
  source.connect(mono);
  mono.connect(merger, 0, 0);
  mono.connect(merger, 0, 1);
  merger.connect(highPass);
  highPass
    .connect(presence)
    .connect(voice)
    .connect(boost)
    .connect(limiter)
    .connect(context.destination);
  const graph = { context, dry, mono, highPass, presence, voice, boost, limiter };
  graphs.set(element, graph);
  apply(graph, settings, true);
}

/** Changes the effects of a routed element while it plays. */
export function update(element: HTMLMediaElement, settings: SoundSettings): void {
  const graph = graphs.get(element);
  if (graph) apply(graph, settings, false);
}

/** Browsers start an AudioContext suspended until a user gesture; Play is one. */
export async function resume(element: HTMLMediaElement): Promise<void> {
  const graph = graphs.get(element);
  if (graph?.context.state === 'suspended') await graph.context.resume().catch(() => {});
}

export function release(element: HTMLMediaElement): void {
  const graph = graphs.get(element);
  graphs.delete(element);
  void graph?.context.close().catch(() => {});
}

function apply(graph: Graph, s: SoundSettings, now: boolean): void {
  const set = (param: AudioParam, value: number) => {
    if (now) param.value = value;
    else param.setTargetAtTime(value, graph.context.currentTime, GLIDE_S);
  };
  set(graph.dry.gain, s.mono ? 0 : 1);
  set(graph.mono.gain, s.mono ? 1 : 0);
  // Off, the high-pass sits below hearing and the presence peak is flat: nothing to switch.
  set(graph.highPass.frequency, s.voiceEq ? 80 : 10);
  set(graph.presence.gain, s.voiceEq ? 4 : 0);
  // Off, a compressor's ratio of 1 does nothing and adds no make-up gain.
  set(graph.voice.threshold, s.voiceEq ? VOICE_THRESHOLD_DB : 0);
  set(graph.voice.ratio, s.voiceEq ? VOICE_RATIO : 1);
  const limit = s.volumeBoost || s.voiceEq;
  set(
    graph.boost.gain,
    (s.volumeBoost ? BOOST_GAIN : 1) * (limit ? MAKEUP_TRIM : 1) * (s.voiceEq ? VOICE_TRIM : 1),
  );
  set(graph.limiter.threshold, limit ? LIMIT_DB : 0);
  set(graph.limiter.ratio, limit ? LIMIT_RATIO : 1);
}
