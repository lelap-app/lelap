import { View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

// Lori, Lelap's mascot: a slow loris, nocturnal like the app's night theme and, like the name,
// from Indonesia. Drawn asleep, curled up with headphones on, from the mascot sketch. Her colours
// are art, never text (contrast: illustration).

const FUR = '#b79878';
const FACE = '#c9ae8c';
const DARK = '#8e7357';
const EARTH = '#3a2a20';
const CREAM = '#ede6d6';
const AMBER = '#f5b041';
const NAVY = '#22324f';

/** Lori asleep with headphones. Decorative; the message next to her says what matters. */
export function Lori({ size = 120 }: { size?: number }) {
  return (
    <View aria-hidden>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Ellipse cx={52} cy={92} rx={36} ry={3.5} fill="#000000" opacity={0.25} />
        <Ellipse cx={54} cy={70} rx={38} ry={22} fill="#a88a6a" />
        <Path
          d="M22 72c3 -13 22 -17 38 -13c13 3 26 2 32 10c-3 13 -19 19 -38 18c-19 0 -35 -4 -32 -15z"
          fill={FUR}
        />
        <Circle cx={33} cy={38} r={5} fill={DARK} />
        <Circle cx={63} cy={38} r={5} fill={DARK} />
        <Ellipse cx={48} cy={53} rx={21} ry={19} fill={FACE} />
        <Ellipse cx={40} cy={52} rx={7.5} ry={8.5} fill={EARTH} />
        <Ellipse cx={56} cy={52} rx={7.5} ry={8.5} fill={EARTH} />
        <Path d="M46 35h4l-0.6 27h-2.8z" fill={CREAM} />
        <Path
          d="M36 54q4 3 8 0M52 54q4 3 8 0"
          stroke={AMBER}
          strokeWidth={1.6}
          strokeLinecap="round"
          fill="none"
        />
        <Ellipse cx={48} cy={63} rx={3} ry={2} fill={EARTH} />
        <Path
          d="M27 53a21 21 0 0 1 42 0"
          stroke={NAVY}
          strokeWidth={4}
          strokeLinecap="round"
          fill="none"
        />
        <Rect x={22} y={47} width={8} height={14} rx={4} fill={AMBER} />
        <Rect x={66} y={47} width={8} height={14} rx={4} fill={AMBER} />
        <Path
          d="M76 32h6l-6 7h6"
          stroke={AMBER}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={0.8}
        />
      </Svg>
    </View>
  );
}
