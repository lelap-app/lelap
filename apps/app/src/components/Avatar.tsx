import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Polygon, Rect } from 'react-native-svg';

// Lelap's own avatars, drawn for the app from simple shapes so their licence is the app's: a
// night theme on amber, teal, rose and navy tiles.

const AMBER = '#f5b041';
const TEAL = '#2a9d8f';
const ROSE = '#e07a8f';
const NAVY = '#24365c';
const CREAM = '#f4f1ea';
const INK = '#0d0e11';

type Drawing = { bg: string; art: ReactNode };

const eye = (cx: number, cy: number, r = 4) => (
  <>
    <Circle cx={cx} cy={cy} r={r + 3} fill={CREAM} />
    <Circle cx={cx} cy={cy} r={r} fill={INK} />
  </>
);

export const AVATARS: Record<string, Drawing> = {
  owl: {
    bg: NAVY,
    art: (
      <>
        <Polygon points="30,30 38,18 44,32" fill={AMBER} />
        <Polygon points="70,30 62,18 56,32" fill={AMBER} />
        <Ellipse cx={50} cy={58} rx={24} ry={28} fill={AMBER} />
        {eye(40, 48, 5)}
        {eye(60, 48, 5)}
        <Polygon points="46,58 54,58 50,66" fill={INK} />
      </>
    ),
  },
  fox: {
    bg: TEAL,
    art: (
      <>
        <Polygon points="24,28 50,78 76,28 64,34 50,30 36,34" fill={AMBER} />
        <Polygon points="24,28 30,14 40,32" fill={AMBER} />
        <Polygon points="76,28 70,14 60,32" fill={AMBER} />
        <Polygon points="40,56 50,78 60,56" fill={CREAM} />
        <Circle cx={41} cy={44} r={3.5} fill={INK} />
        <Circle cx={59} cy={44} r={3.5} fill={INK} />
        <Circle cx={50} cy={76} r={3} fill={INK} />
      </>
    ),
  },
  moon: {
    bg: NAVY,
    art: (
      <>
        <Path d="M58 20 A30 30 0 1 0 80 62 A24 24 0 1 1 58 20 Z" fill={AMBER} />
        <Circle cx={30} cy={28} r={2} fill={CREAM} />
        <Circle cx={74} cy={30} r={1.5} fill={CREAM} />
        <Circle cx={22} cy={70} r={1.5} fill={CREAM} />
      </>
    ),
  },
  lantern: {
    bg: ROSE,
    art: (
      <>
        <Circle cx={50} cy={56} r={30} fill={AMBER} opacity={0.25} />
        <Rect x={44} y={16} width={12} height={6} rx={2} fill={INK} />
        <Rect x={34} y={24} width={32} height={46} rx={10} fill={AMBER} />
        <Rect x={34} y={36} width={32} height={3} fill={INK} opacity={0.3} />
        <Rect x={34} y={54} width={32} height={3} fill={INK} opacity={0.3} />
        <Rect x={40} y={70} width={20} height={6} rx={2} fill={INK} />
      </>
    ),
  },
  whale: {
    bg: TEAL,
    art: (
      <>
        <Path
          d="M18 58 Q20 36 50 36 Q78 36 80 56 L90 46 L88 64 Q70 76 46 74 Q20 72 18 58 Z"
          fill={NAVY}
        />
        <Path d="M22 62 Q40 72 66 66" stroke={CREAM} strokeWidth={3} fill="none" />
        <Circle cx={34} cy={50} r={3} fill={CREAM} />
        <Path
          d="M46 30 Q44 20 38 18 M46 30 Q48 20 54 18"
          stroke={CREAM}
          strokeWidth={3}
          fill="none"
        />
      </>
    ),
  },
  cat: {
    bg: AMBER,
    art: (
      <>
        <Polygon points="26,42 30,16 46,32" fill={INK} />
        <Polygon points="74,42 70,16 54,32" fill={INK} />
        <Circle cx={50} cy={54} r={28} fill={INK} />
        <Ellipse cx={40} cy={50} rx={4} ry={6} fill={AMBER} />
        <Ellipse cx={60} cy={50} rx={4} ry={6} fill={AMBER} />
        <Polygon points="47,62 53,62 50,66" fill={ROSE} />
      </>
    ),
  },
  star: {
    bg: NAVY,
    art: (
      <Polygon points="50,14 59,39 86,40 65,56 72,82 50,67 28,82 35,56 14,40 41,39" fill={AMBER} />
    ),
  },
  cloud: {
    bg: ROSE,
    art: (
      <>
        <Circle cx={38} cy={54} r={16} fill={CREAM} />
        <Circle cx={56} cy={46} r={20} fill={CREAM} />
        <Circle cx={70} cy={58} r={13} fill={CREAM} />
        <Rect x={26} y={56} width={56} height={14} rx={7} fill={CREAM} />
      </>
    ),
  },
  mountain: {
    bg: NAVY,
    art: (
      <>
        <Circle cx={70} cy={28} r={8} fill={AMBER} />
        <Polygon points="10,80 40,34 70,80" fill={TEAL} />
        <Polygon points="44,80 66,48 90,80" fill={CREAM} opacity={0.85} />
        <Polygon points="40,34 32,46 48,46" fill={CREAM} />
      </>
    ),
  },
  pine: {
    bg: TEAL,
    art: (
      <>
        <Polygon points="50,14 70,42 30,42" fill={NAVY} />
        <Polygon points="50,28 76,62 24,62" fill={NAVY} />
        <Polygon points="50,44 82,80 18,80" fill={NAVY} />
        <Rect x={45} y={78} width={10} height={10} fill={INK} />
      </>
    ),
  },
  bird: {
    bg: AMBER,
    art: (
      <>
        <Ellipse cx={48} cy={54} rx={24} ry={18} fill={ROSE} />
        <Circle cx={66} cy={42} r={12} fill={ROSE} />
        <Polygon points="76,40 88,44 76,48" fill={INK} />
        <Circle cx={68} cy={40} r={2.5} fill={INK} />
        <Path d="M34 50 Q46 40 56 56 Q42 60 34 50 Z" fill={CREAM} />
        <Polygon points="24,52 12,44 16,60" fill={ROSE} />
      </>
    ),
  },
  fish: {
    bg: NAVY,
    art: (
      <>
        <Ellipse cx={46} cy={50} rx={26} ry={16} fill={AMBER} />
        <Polygon points="70,50 88,36 88,64" fill={AMBER} />
        <Circle cx={32} cy={46} r={3.5} fill={INK} />
        <Path d="M46 38 Q52 50 46 62" stroke={INK} strokeWidth={2} fill="none" opacity={0.4} />
      </>
    ),
  },
  bear: {
    bg: ROSE,
    art: (
      <>
        <Circle cx={30} cy={30} r={10} fill={NAVY} />
        <Circle cx={70} cy={30} r={10} fill={NAVY} />
        <Circle cx={50} cy={54} r={28} fill={NAVY} />
        <Ellipse cx={50} cy={64} rx={12} ry={9} fill={CREAM} />
        <Circle cx={50} cy={60} r={3.5} fill={INK} />
        <Circle cx={40} cy={48} r={3} fill={CREAM} />
        <Circle cx={60} cy={48} r={3} fill={CREAM} />
      </>
    ),
  },
  rabbit: {
    bg: TEAL,
    art: (
      <>
        <Ellipse cx={40} cy={28} rx={7} ry={20} fill={CREAM} />
        <Ellipse cx={60} cy={28} rx={7} ry={20} fill={CREAM} />
        <Circle cx={50} cy={62} r={24} fill={CREAM} />
        <Circle cx={42} cy={58} r={3} fill={INK} />
        <Circle cx={58} cy={58} r={3} fill={INK} />
        <Circle cx={50} cy={67} r={3} fill={ROSE} />
      </>
    ),
  },
  hedgehog: {
    bg: AMBER,
    art: (
      <>
        <Path
          d="M16 72 L22 50 L30 58 L34 36 L42 50 L50 30 L56 50 L64 36 L68 56 L76 46 L78 72 Z"
          fill={INK}
        />
        <Ellipse cx={74} cy={66} rx={14} ry={10} fill={CREAM} />
        <Circle cx={86} cy={66} r={3} fill={INK} />
        <Circle cx={74} cy={62} r={2} fill={INK} />
      </>
    ),
  },
  house: {
    bg: NAVY,
    art: (
      <>
        <Polygon points="50,18 84,48 16,48" fill={ROSE} />
        <Rect x={24} y={46} width={52} height={36} fill={CREAM} />
        <Rect x={32} y={54} width={14} height={12} fill={AMBER} />
        <Rect x={54} y={58} width={14} height={24} fill={INK} />
      </>
    ),
  },
  boat: {
    bg: TEAL,
    art: (
      <>
        <Polygon points="50,16 50,62 22,62" fill={CREAM} />
        <Polygon points="54,26 54,62 76,62" fill={AMBER} />
        <Path d="M16 66 L84 66 L74 80 L26 80 Z" fill={NAVY} />
      </>
    ),
  },
  rocket: {
    bg: ROSE,
    art: (
      <>
        <Path d="M50 14 Q66 30 64 64 L36 64 Q34 30 50 14 Z" fill={CREAM} />
        <Circle cx={50} cy={40} r={7} fill={NAVY} />
        <Polygon points="36,52 24,70 36,66" fill={NAVY} />
        <Polygon points="64,52 76,70 64,66" fill={NAVY} />
        <Polygon points="42,64 50,84 58,64" fill={AMBER} />
      </>
    ),
  },
  mushroom: {
    bg: NAVY,
    art: (
      <>
        <Path d="M16 52 Q18 20 50 20 Q82 20 84 52 Z" fill={ROSE} />
        <Rect x={40} y={50} width={20} height={30} rx={6} fill={CREAM} />
        <Circle cx={36} cy={38} r={5} fill={CREAM} />
        <Circle cx={60} cy={32} r={4} fill={CREAM} />
        <Circle cx={68} cy={44} r={3} fill={CREAM} />
      </>
    ),
  },
  planet: {
    bg: TEAL,
    art: (
      <>
        <Circle cx={50} cy={50} r={22} fill={AMBER} />
        <Ellipse
          cx={50}
          cy={52}
          rx={40}
          ry={10}
          fill="none"
          stroke={CREAM}
          strokeWidth={4}
          transform="rotate(-18 50 52)"
        />
        <Path d="M30 44 Q50 36 70 44" stroke={INK} strokeWidth={2} fill="none" opacity={0.3} />
      </>
    ),
  },
};

export const AVATAR_IDS = Object.keys(AVATARS);

const TILES = [AMBER, TEAL, ROSE, NAVY];

/** A new profile's avatar: one nobody uses yet, else any. */
export function pickAvatar(used: (string | null)[], random = Math.random): string {
  const free = AVATAR_IDS.filter((id) => !used.includes(id));
  const pool = free.length > 0 ? free : AVATAR_IDS;
  return pool[Math.floor(random() * pool.length)] ?? 'owl';
}

/** The avatar, or the name's initial on a colour from the name. */
export function Avatar({
  avatar,
  name,
  size,
}: {
  avatar: string | null;
  name: string;
  size: number;
}) {
  const drawing = avatar ? AVATARS[avatar] : undefined;
  if (!drawing) {
    const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    return (
      <View
        style={{ width: size, height: size, backgroundColor: TILES[hash % TILES.length] }}
        className="items-center justify-center rounded-2xl"
      >
        <Text style={{ fontSize: size / 2.2, color: CREAM }} className="font-semibold">
          {name.trim().charAt(0).toUpperCase() || '?'}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size }} className="overflow-hidden rounded-2xl">
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Rect width={100} height={100} fill={drawing.bg} />
        {drawing.art}
      </Svg>
    </View>
  );
}
