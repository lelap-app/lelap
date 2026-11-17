import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from './db';
import { settings } from './schema';

export const SettingsSchema = z.object({
  duckOnInterruption: z.boolean().default(true),
  skipIntervalMs: z.number().int().positive().default(30_000),
  smartRewind: z.boolean().default(true),
  downloadOnWifiOnly: z.boolean().default(true),
  downloadWhileChargingOnly: z.boolean().default(false),
  /** Offer beta versions of the Android app. */
  betaUpdates: z.boolean().default(false),
  /** Download JavaScript updates in the background; they apply on the next start. */
  otaUpdates: z.boolean().default(true),
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
