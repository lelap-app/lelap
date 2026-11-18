import type { ReactNode } from 'react';
import { I18nManager, Platform, Pressable } from 'react-native';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';

// One icon set for the whole app, drawn on a 24-unit grid in the design sketch's style: 1.8
// strokes with round caps, filled shapes only for play and pause.

// `value` is the number some icons carry, such as the skip interval in seconds.
type Draw = (color: string, value?: string) => ReactNode;

const stroke = (color: string) => ({
  stroke: color,
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
});

const skip = (color: string, forward: boolean, seconds = '30') => (
  <>
    <Path
      d={forward ? 'M20 12a8 8 0 1 1-2.5-5.8' : 'M4 12a8 8 0 1 0 2.5-5.8'}
      {...stroke(color)}
      strokeWidth={1.6}
    />
    <Path d={forward ? 'M20 3v4h-4' : 'M4 3v4h4'} {...stroke(color)} strokeWidth={1.6} />
    <SvgText x={12} y={15} textAnchor="middle" fontSize={7} fontWeight="600" fill={color}>
      {seconds}
    </SvgText>
  </>
);

const ICONS = {
  play: (c) => <Path d="M8 5v14l11-7z" fill={c} />,
  pause: (c) => (
    <>
      <Rect x={6} y={5} width={4} height={14} rx={1} fill={c} />
      <Rect x={14} y={5} width={4} height={14} rx={1} fill={c} />
    </>
  ),
  skipBack: (c, v) => skip(c, false, v),
  skipForward: (c, v) => skip(c, true, v),
  previous: (c) => (
    <>
      <Path d="M6 5v14" {...stroke(c)} />
      <Path d="M19 6v12l-9-6z" fill={c} />
    </>
  ),
  next: (c) => (
    <>
      <Path d="M18 5v14" {...stroke(c)} />
      <Path d="M5 6v12l9-6z" fill={c} />
    </>
  ),
  down: (c) => <Path d="m6 9 6 6 6-6" {...stroke(c)} />,
  up: (c) => <Path d="m6 15 6-6 6 6" {...stroke(c)} />,
  back: (c) => <Path d="m15 6-6 6 6 6" {...stroke(c)} />,
  forward: (c) => <Path d="m9 6 6 6-6 6" {...stroke(c)} />,
  close: (c) => <Path d="M6 6l12 12M18 6 6 18" {...stroke(c)} />,
  settings: (c) => (
    <>
      <Path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" {...stroke(c)} />
      <Circle cx={16} cy={6} r={2} {...stroke(c)} />
      <Circle cx={10} cy={12} r={2} {...stroke(c)} />
      <Circle cx={18} cy={18} r={2} {...stroke(c)} />
    </>
  ),
  home: (c) => (
    <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" {...stroke(c)} />
  ),
  discover: (c) => (
    <>
      <Circle cx={12} cy={12} r={9} {...stroke(c)} />
      <Path d="m15.5 8.5-2 5-5 2 2-5z" {...stroke(c)} />
    </>
  ),
  search: (c) => (
    <>
      <Circle cx={11} cy={11} r={7} {...stroke(c)} />
      <Path d="m20 20-3.5-3.5" {...stroke(c)} />
    </>
  ),
  podcast: (c) => (
    <>
      <Circle cx={12} cy={11} r={2.5} {...stroke(c)} />
      <Path d="M12 14.5V21M7.8 15.5a6 6 0 1 1 8.4 0M5 18.3a9.5 9.5 0 1 1 14 0" {...stroke(c)} />
    </>
  ),
  library: (c) => (
    <>
      <Path d="M4 4h4v16H4zM10 4h4v16h-4z" {...stroke(c)} />
      <Path d="m16 5 3.5-1 2.5 15.5-3.5 1z" {...stroke(c)} />
    </>
  ),
  addons: (c) => (
    <>
      <Rect x={3} y={3} width={7} height={7} rx={1.5} {...stroke(c)} />
      <Rect x={14} y={3} width={7} height={7} rx={1.5} {...stroke(c)} />
      <Rect x={3} y={14} width={7} height={7} rx={1.5} {...stroke(c)} />
      <Path d="M17.5 14v7M14 17.5h7" {...stroke(c)} />
    </>
  ),
  moon: (c) => <Path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" {...stroke(c)} />,
  bookmark: (c) => <Path d="M6 4h12v17l-6-4-6 4z" {...stroke(c)} />,
  bookmarkAdd: (c) => (
    <>
      <Path d="M6 4h12v17l-6-4-6 4z" {...stroke(c)} />
      <Path d="M12 8v6M9 11h6" {...stroke(c)} />
    </>
  ),
  chapters: (c) => (
    <Path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" {...stroke(c)} />
  ),
  speed: (c) => (
    <>
      <Path d="M4.5 17a8.5 8.5 0 1 1 15 0" {...stroke(c)} />
      <Path d="m12 13 4-5" {...stroke(c)} />
    </>
  ),
  cast: (c) => (
    <>
      <Path d="M3 8V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" {...stroke(c)} />
      <Path d="M3 12a8 8 0 0 1 8 8M3 16a4 4 0 0 1 4 4" {...stroke(c)} />
      <Circle cx={3.5} cy={19.5} r={1.2} fill={c} />
    </>
  ),
  check: (c) => (
    <>
      <Circle cx={12} cy={12} r={9} {...stroke(c)} />
      <Path d="m8 12 3 3 5-6" {...stroke(c)} />
    </>
  ),
  info: (c) => (
    <>
      <Circle cx={12} cy={12} r={9} {...stroke(c)} />
      <Path d="M12 11v6" {...stroke(c)} />
      <Circle cx={12} cy={7.5} r={1.2} fill={c} />
    </>
  ),
  show: (c) => (
    <>
      <Path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
        {...stroke(c)}
      />
      <Circle cx={12} cy={12} r={3} {...stroke(c)} />
    </>
  ),
  hide: (c) => (
    <>
      <Path
        d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 7.1C4 8.8 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"
        {...stroke(c)}
      />
    </>
  ),
  download: (c) => <Path d="M12 4v11M7 10l5 5 5-5M5 20h14" {...stroke(c)} />,
  cloud: (c) => (
    <Path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z" {...stroke(c)} />
  ),
  plane: (c) => (
    <Path
      d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"
      fill={c}
    />
  ),
  plus: (c) => <Path d="M12 5v14M5 12h14" {...stroke(c)} />,
  rescan: (c) => (
    <>
      <Path d="M19 12a7 7 0 0 1-12.2 4.7M5 12a7 7 0 0 1 12.2-4.7" {...stroke(c)} />
      <Path d="M17.5 3.5v4h-4M6.5 20.5v-4h4" {...stroke(c)} />
    </>
  ),
  stats: (c) => <Path d="M5 20V11M12 20V5M19 20v-6M3 20h18" {...stroke(c)} />,
  more: (c) => (
    <>
      <Circle cx={5} cy={12} r={1.6} fill={c} />
      <Circle cx={12} cy={12} r={1.6} fill={c} />
      <Circle cx={19} cy={12} r={1.6} fill={c} />
    </>
  ),
  lock: (c) => (
    <>
      <Rect x={5} y={11} width={14} height={10} rx={2} {...stroke(c)} />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" {...stroke(c)} />
    </>
  ),
  queue: (c) => <Path d="M4 6h16M4 12h10M4 18h10M18 14v6M15 17h6" {...stroke(c)} />,
  soundbite: (c) => <Path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" {...stroke(c)} />,
  transcript: (c) => (
    <>
      <Path
        d="M5 4h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
        {...stroke(c)}
      />
      <Path d="M8 9h8M8 12.5h5" {...stroke(c)} />
    </>
  ),
  heart: (c) => (
    <Path
      d="M12 20s-7.5-4.6-7.5-10A4.5 4.5 0 0 1 12 7.4 4.5 4.5 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"
      {...stroke(c)}
    />
  ),
  person: (c) => (
    <>
      <Circle cx={12} cy={8} r={4} {...stroke(c)} />
      <Path d="M4.5 20a7.5 7.5 0 0 1 15 0" {...stroke(c)} />
    </>
  ),
  sound: (c) => (
    <>
      <Path d="M6 4v16M12 4v16M18 4v16" {...stroke(c)} />
      <Circle cx={6} cy={14} r={2} fill={c} />
      <Circle cx={12} cy={8} r={2} fill={c} />
      <Circle cx={18} cy={16} r={2} fill={c} />
    </>
  ),
  car: (c) => (
    <>
      <Path
        d="M4 16v-4l2.2-5.2A1.5 1.5 0 0 1 7.6 6h8.8a1.5 1.5 0 0 1 1.4.8L20 12v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 12h16M7 17v2M17 17v2"
        {...stroke(c)}
      />
      <Circle cx={7.5} cy={14.5} r={1} fill={c} />
      <Circle cx={16.5} cy={14.5} r={1} fill={c} />
    </>
  ),
  headphones: (c) => (
    <Path
      d="M4 17v-5a8 8 0 0 1 16 0v5M4 15h3v5H5a1 1 0 0 1-1-1zM20 15h-3v5h2a1 1 0 0 0 1-1z"
      {...stroke(c)}
    />
  ),
} satisfies Record<string, Draw>;

export type IconName = keyof typeof ICONS;

// Decorative icons stay out of the screen reader; react-native-svg passes props to the DOM on the web.
const HIDDEN =
  Platform.OS === 'web'
    ? { 'aria-hidden': true }
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

// Chevrons point the way the layout reads, so they turn round right to left. Media icons
// (skip, previous, next) keep their direction, as time runs left to right everywhere.
const MIRRORED = new Set<string>(['back', 'forward']);

/** An icon from the app's set. Decorative unless `label` is given. */
export function Icon({
  name,
  size = 24,
  color = '#f4f1ea',
  label,
  value,
}: {
  name: IconName;
  size?: number;
  color?: string;
  label?: string;
  value?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...(I18nManager.isRTL && MIRRORED.has(name)
        ? { style: { transform: [{ scaleX: -1 }] } }
        : {})}
      {...(label === undefined ? {} : { accessibilityLabel: label })}
      {...(label === undefined ? HIDDEN : {})}
    >
      {ICONS[name](color, value)}
    </Svg>
  );
}

/** Theme colours for icons, matching `tailwind.config.js`. */
export const COLORS = {
  night: '#0d0e11',
  raised: '#17191e',
  paper: '#f4f1ea',
  soft: '#c9c5bc',
  muted: '#8d8a83',
  line: '#33353b',
  amber: '#f5b041',
  ink: '#1a1305',
  danger: '#ff8a7a',
  ok: '#6bd49a',
} as const;

/** A 48-point icon button for headers and toolbars. */
export function IconButton({
  name,
  label,
  onPress,
  size = 24,
  color = COLORS.paper,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      {...(label === undefined ? {} : { accessibilityLabel: label })}
      className="h-12 w-12 items-center justify-center rounded-full active:bg-raised"
    >
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}
