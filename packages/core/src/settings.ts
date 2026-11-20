import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { CAST_GROUPS_KEPT, CastGroupSchema } from './castGroups';
import type { Db } from './db';
import { settings } from './schema';
import { AccentChoiceSchema, CustomThemeSchema, ThemeChoiceSchema } from './themes';

/** The volume during calls when it is lowered, in percent of normal; 20 was the old fixed level. */
export const DUCK_PERCENT = { min: 20, max: 100, step: 10, default: 20 } as const;

export const SettingsSchema = z.object({
  /**
   * During calls (Android): true lowers the volume to `duckPercent`, false pauses until the call
   * ends. The switch kept its key and meaning, so a stored “on” is lowering to 20 %.
   */
  duckOnInterruption: z.boolean().default(true),
  duckPercent: z
    .number()
    .int()
    .min(DUCK_PERCENT.min)
    .max(DUCK_PERCENT.max)
    .multipleOf(DUCK_PERCENT.step)
    .default(DUCK_PERCENT.default),
  skipIntervalMs: z.number().int().positive().default(30_000),
  smartRewind: z.boolean().default(true),
  /** Sound (M22), for every book: mono and voice EQ suit the listener's ears and follow them. */
  mono: z.boolean().default(false),
  /**
   * Voice boost, skip silence and even loudness (M84) are defaults: a book or show may set its
   * own (`chooseSound`). Voice boost kept its M22 key, so the listener's choice carries over.
   */
  voiceEq: z.boolean().default(false),
  skipSilence: z.boolean().default(false),
  evenLoudness: z.boolean().default(false),
  /** Suits a quiet speaker or recording, so it stays with this device. */
  volumeBoost: z.boolean().default(false),
  downloadOnWifiOnly: z.boolean().default(true),
  downloadWhileChargingOnly: z.boolean().default(false),
  /** Offer beta versions of the Android app. */
  betaUpdates: z.boolean().default(false),
  /** Download JavaScript updates in the background; they apply on the next start. */
  otaUpdates: z.boolean().default(true),
  /** Books to finish this year; 0 means no goal. Stays on this device. */
  yearlyGoalBooks: z.number().int().min(0).max(1000).default(0),
  /**
   * The bedtime routine (M33, M86): a sleep timer and `bedtimeVolume` start by themselves when
   * the window opens while playing, or when playback starts inside it.
   */
  bedtimeTimer: z.boolean().default(false),
  /** Minutes after local midnight; the window may cross midnight. */
  bedtimeStart: z
    .number()
    .int()
    .min(0)
    .max(1439)
    .default(22 * 60),
  bedtimeEnd: z
    .number()
    .int()
    .min(0)
    .max(1439)
    .default(2 * 60),
  /** To the end of the chapter (or episode) instead of `bedtimeMinutes`. */
  bedtimeChapter: z.boolean().default(false),
  bedtimeMinutes: z.number().int().min(1).max(240).default(30),
  /** Percent of the normal volume while the routine's timer runs; 100 leaves it as it is. */
  bedtimeVolume: z.number().int().min(10).max(100).default(100),
  /** In the sleep timer's last five minutes, a shake adds ten more (Android). */
  shakeToExtend: z.boolean().default(true),
  /** Warn when the Bluetooth headphones' battery likely won't last; needs nearby devices. */
  headphoneBattery: z.boolean().default(false),
  /** Offer car mode when the phone connects to a car's Bluetooth; needs nearby devices. */
  carModeOffer: z.boolean().default(false),
  /** “Because you finished …” rows on Home (M46), worked out on this device. */
  homeSuggestions: z.boolean().default(true),
  /** Rating, new episodes, finished and progress drawn on covers (M49). */
  badgesOnCovers: z.boolean().default(true),
  /** The Library's Finished group (M79) is open; it starts closed, out of the way. */
  libraryFinishedOpen: z.boolean().default(false),
  /**
   * Where the listener dragged the dividers on a wide screen (M113), in points; null is the
   * default width. Not synced: a laptop and a tablet want their own.
   */
  playerPaneWidth: z.number().int().min(0).max(4000).nullable().default(null),
  detailPaneWidth: z.number().int().min(0).max(4000).nullable().default(null),
  /**
   * The app's language for this profile; a new profile starts with its creator's. Any language
   * code, so a new catalog needs no change here; the app shows English for one it has no file for.
   */
  language: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .default('en'),
  /** The look (M108), per profile like the language: a built-in theme, the system's, or a file's. */
  theme: ThemeChoiceSchema.default('night'),
  accent: AccentChoiceSchema.default('amber'),
  /** The theme last read from a file, already checked for contrast; `theme: 'custom'` uses it. */
  customTheme: CustomThemeSchema.nullable().default(null),
  /**
   * Settings → Streams (M153), per profile and synced: formats in order, such as `['m4b']`;
   * languages in order, null for the profile's language; and whether streams still preparing
   * are listed.
   */
  streamFormats: z
    .array(z.string().regex(/^[a-z0-9]{1,20}$/))
    .max(20)
    .default([]),
  streamLanguages: z
    .array(z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/))
    .max(10)
    .nullable()
    .default(null),
  showPreparingStreams: z.boolean().default(true),
  /** Speaker groups played on (M125), newest first, for one tap in the Cast sheet. */
  castGroups: z.array(CastGroupSchema).max(CAST_GROUPS_KEPT).default([]),
});

export type Settings = z.infer<typeof SettingsSchema>;

const DEFAULTS = SettingsSchema.parse({});

export function getSettings(db: Db, profileId: string): Settings {
  const result: Settings = { ...DEFAULTS };
  const rows = db.select().from(settings).where(eq(settings.profileId, profileId)).all();
  for (const { key, value } of rows) {
    if (!(key in SettingsSchema.shape)) continue;
    const field = SettingsSchema.shape[key as keyof Settings];
    try {
      const parsed = field.safeParse(JSON.parse(value));
      if (parsed.success) Object.assign(result, { [key]: parsed.data });
    } catch {
      // Unreadable JSON keeps the default.
    }
  }
  return result;
}

export function setSetting<K extends keyof Settings>(
  db: Db,
  profileId: string,
  key: K,
  value: Settings[K],
  now: number,
): void {
  const json = JSON.stringify(SettingsSchema.shape[key].parse(value));
  db.insert(settings)
    .values({ profileId, key, value: json, updatedAt: now })
    .onConflictDoUpdate({
      target: [settings.profileId, settings.key],
      set: { value: json, updatedAt: now },
    })
    .run();
}
