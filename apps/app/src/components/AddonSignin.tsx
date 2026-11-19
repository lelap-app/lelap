import { hostAllowed } from '@lelap/core';
import {
  type Manifest,
  type SettingField,
  type Settings,
  type SigninResult,
  SigninResult as SigninResultSchema,
  type SigninStart,
  SigninStart as SigninStartSchema,
} from '@lelap/sdk';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';

import { showAlert } from '../dialog';
import { t } from '../i18n';
import { callAddonSignin } from '../sandbox';
import { useColors } from '../theme';

// An add-on's sign-in through a website (revision 7), such as Plex's: the add-on gives a code and
// a page, the listener enters the code there on any device, and the add-on hands back what it
// keeps. The app asks it every few seconds until then.

// The add-on's own expiry counts if it is sooner, but never less than a minute: the phone's clock
// and the website's may differ.
const MAX_WAIT_MS = 30 * 60_000;
const MIN_WAIT_MS = 60_000;
// A check that fails once, such as on a moment without network, doesn't end the sign-in.
const MAX_FAILURES = 3;

function said(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null && 'error' in body) return String(body.error);
  return t('The add-on answered {status}.', { status });
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function AddonSignin({
  field,
  addonUrl,
  manifest,
  sandboxId,
  values,
  known = {},
  onDone,
}: {
  field: SettingField;
  addonUrl: string;
  manifest: Manifest;
  sandboxId: string;
  values: Settings;
  /** The sealed values of a server already added, so signing in again keeps what it can. */
  known?: Settings;
  onDone: (result: SigninResult) => void;
}) {
  const colors = useColors();
  const [pending, setPending] = useState<SigninStart | null>(null);
  const [busy, setBusy] = useState(false);
  // The form's values at the time of each check, without starting the checks again.
  const latest = useRef({ ...known, ...values });
  latest.current = { ...known, ...values };
  // The form when the sign-in started: a field the listener changed since keeps their value.
  const started = useRef<Settings>({});
  // Only the add-on's declared hosts: the sign-in needs no address from the form.
  const hosts = manifest.sandbox?.hosts ?? [];
  const done = useRef(onDone);
  done.current = onDone;
  const signedIn = (values[field.key] ?? '') !== '';

  const call = async (step: 'start' | 'check', state?: string) => {
    const { status, body } = await callAddonSignin({
      addonUrl,
      sandboxId,
      hosts,
      settings: latest.current,
      step,
      ...(state === undefined ? {} : { state }),
    });
    if (status !== 200) throw new Error(said(body, status));
    return body;
  };

  const start = async () => {
    setBusy(true);
    started.current = { ...latest.current };
    try {
      const parsed = SigninStartSchema.safeParse(await call('start'));
      // The page to open is on one of the add-on's declared hosts, never anywhere it likes.
      if (!parsed.success || !hostAllowed(parsed.data.url, hosts)) {
        throw new Error(t('The add-on’s sign-in is not valid.'));
      }
      setPending(parsed.data);
    } catch (error) {
      showAlert(t('Could not sign in'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    const now = Date.now();
    const until = Math.min(
      Math.max(pending.expiresAt ?? Infinity, now + MIN_WAIT_MS),
      now + MAX_WAIT_MS,
    );
    const every = (pending.interval ?? 5) * 1000;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (stopped) return;
      if (Date.now() > until) {
        setPending(null);
        showAlert(t('Could not sign in'), t('The code ran out. Sign in again for a new one.'));
        return;
      }
      try {
        const parsed = SigninResultSchema.safeParse(await call('check', pending.state));
        if (stopped) return;
        if (!parsed.success) throw new Error(t('The add-on’s sign-in is not valid.'));
        if (parsed.data.settings) {
          setPending(null);
          const form = latest.current;
          const before = started.current;
          const untouched = Object.entries(parsed.data.settings).filter(
            ([key]) => (form[key] ?? '') === (before[key] ?? ''),
          );
          done.current({ settings: Object.fromEntries(untouched) });
          return;
        }
        failures = 0;
      } catch (error) {
        if (stopped) return;
        if (++failures < MAX_FAILURES) {
          timer = setTimeout(() => void check(), every);
          return;
        }
        setPending(null);
        showAlert(t('Could not sign in'), error instanceof Error ? error.message : String(error));
        return;
      }
      timer = setTimeout(() => void check(), every);
    };
    timer = setTimeout(() => void check(), every);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // Only a new sign-in starts the checks again; `call` reads the form through `latest`.
  }, [pending]);

  return (
    <View className="gap-2">
      <Text className="text-sm text-soft">{field.label}</Text>
      {pending ? (
        <View className="gap-3 rounded-lg border border-line p-3">
          <Text className="text-soft">
            {t('Open {host} on any device and enter this code:', { host: hostOf(pending.url) })}
          </Text>
          <Text
            accessibilityLabel={t('Code: {code}', { code: pending.code.split('').join(' ') })}
            selectable
            className="text-3xl font-semibold tracking-widest text-paper"
          >
            {pending.code}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(pending.url)}
              className="min-h-12 items-center justify-center rounded-full bg-amber px-5 active:opacity-80"
            >
              <Text className="font-semibold text-ink">
                {t('Open {host}', { host: hostOf(pending.url) })}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPending(null)}
              className="min-h-12 items-center justify-center rounded-full border border-line px-5 active:opacity-80"
            >
              <Text className="text-soft">{t('Cancel')}</Text>
            </Pressable>
          </View>
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" color={colors.muted} />
            <Text className="text-xs text-muted">{t('Waiting for the code to be entered…')}</Text>
          </View>
        </View>
      ) : (
        <View className="flex-row flex-wrap items-center gap-3">
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void start()}
            {...(busy ? { accessibilityLabel: t('Sign in') } : {})}
            className="min-h-12 items-center justify-center rounded-full border border-amber px-5 active:opacity-80"
          >
            {busy ? (
              <ActivityIndicator color={colors.amber} />
            ) : (
              <Text className="font-semibold text-amber">
                {signedIn ? t('Sign in again') : t('Sign in')}
              </Text>
            )}
          </Pressable>
          {signedIn && <Text className="text-soft">{t('Signed in.')}</Text>}
        </View>
      )}
      {field.help && <Text className="text-xs text-muted">{field.help}</Text>}
    </View>
  );
}
