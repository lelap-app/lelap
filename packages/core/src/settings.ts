import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from './db';
import { settings } from './schema';

export const SettingsSchema = z.object({
  duckOnInterruption: z.boolean().default(true),
  skipIntervalMs: z.number().int().positive().default(30_000),
  smartRewind: z.boolean().default(true),
  /** Sound (M22), for every book: mono and voice EQ suit the listener's ears and follow them. */
  mono: z.boolean().default(false),
  voiceEq: z.boolean().default(false),
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
  /** Bedtime (M33): a sleep timer starts by itself when playback starts inside the window. */
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
  /** Warn when the Bluetooth headphones' battery likely won't last; needs nearby devices. */
  headphoneBattery: z.boolean().default(false),
  /** Offer car mode when the phone connects to a car's Bluetooth; needs nearby devices. */
  carModeOffer: z.boolean().default(false),
  /** “Because you finished …” rows on Home (M46), worked out on this device. */
  homeSuggestions: z.boolean().default(true),
  /**
   * The app's language for this profile; a new profile starts with its creator's. Any language
   * code, so a new catalog needs no change here; the app shows English for one it has no file for.
   */
  language: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .default('en'),
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
