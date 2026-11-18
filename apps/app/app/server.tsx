import {
  addonSource,
  addRemoteRoot,
  type AudiobookshelfLibrary,
  audiobookshelfMe,
  checkWebdav,
  type JellyfinLibrary,
  listAudiobookshelfLibraries,
  listJellyfinLibraries,
  listRoots,
  listS3,
  RemoteError,
  type RemoteSource,
  signInJellyfin,
  updateRemoteRoot,
} from '@lelap/core';
import { offersPlaces, readSettings, type Settings } from '@lelap/sdk';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { showAlert } from '../src/dialog';
import { COLORS, IconButton } from '../src/components/Icon';
import { db, newId } from '../src/db';
import { useLibrary } from '../src/player';
import { profileId } from '../src/profile';
import { scanLibrary } from '../src/scan';
import { Pill } from '../src/components/Pill';
import {
  codeFingerprint,
  libraryKinds,
  listAddonLibrary,
  type SourceKind,
} from '../src/addonSources';
import { closeSandbox } from '../src/sandbox';

type BuiltIn = 'webdav' | 's3' | 'jellyfin' | 'audiobookshelf';
/** A built-in kind, or an add-on inside the app by its manifest URL (M57). */
type Kind = BuiltIn | `addon:${string}`;

const KIND_LABEL: Record<BuiltIn, string> = {
  webdav: 'WebDAV',
  s3: t('S3-compatible'),
  jellyfin: 'Jellyfin',
  audiobookshelf: 'Audiobookshelf',
};

const BUILT_IN: BuiltIn[] = ['webdav', 's3', 'jellyfin', 'audiobookshelf'];

const addonKind = (url: string): Kind => `addon:${url}`;

/** Why a server could not be reached, with what a browser adds to it. */
function reason(error: unknown, label: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (Platform.OS === 'web' && error instanceof RemoteError && error.status === 0) {
    return `${message}\n\nIn the browser the ${label} server must allow this site (CORS headers), and an http:// server can't be reached from an https:// page. The Android app has neither limit.`;
  }
  return message;
}

type SignedIn = { userId: string; token: string; libraries: JellyfinLibrary[] };
type AbsSignedIn = {
  userId: string;
  username: string;
  libraries: AudiobookshelfLibrary[];
};

/** A library to pick, with what it holds when that can differ. */
function LibrarySwitch({
  name,
  detail,
  on,
  onChange,
}: {
  name: string;
  detail?: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <View className="flex-1">
        <Text className="text-paper">{name}</Text>
        {detail && <Text className="text-xs text-muted">{detail}</Text>}
      </View>
      <Switch accessibilityLabel={name} value={on} onValueChange={onChange} />
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secret = false,
  locked = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secret?: boolean;
  /** Shown but not editable: the server's place when only the login is entered again. */
  locked?: boolean;
  hint?: string;
}) {
  return (
    <View className="gap-1">
      <Text className="text-sm text-soft">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        accessibilityLabel={label}
        {...(hint === undefined ? {} : { accessibilityHint: hint })}
        placeholderTextColor="#8d8a83"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secret}
        editable={!locked}
        className={`rounded-lg border border-line px-3 py-2 ${locked ? 'text-muted' : 'text-paper'}`}
      />
      {hint && <Text className="text-xs text-muted">{hint}</Text>}
    </View>
  );
}

/** Adds a WebDAV server, an S3-compatible bucket, or a Jellyfin or Audiobookshelf server. */
export default function ServerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh } = useLibrary();
  // `?root=` enters the login again for a server whose password this phone can't open.
  const { root: rootId } = useLocalSearchParams<{ root?: string }>();
  const [existing] = useState(() => listRoots(db).find((r) => r.id === rootId)?.remote ?? null);
  const dav = existing?.type === 'webdav' ? existing : null;
  const s3 = existing?.type === 's3' ? existing : null;
  const jf = existing?.type === 'jellyfin' ? existing : null;
  const abs = existing?.type === 'audiobookshelf' ? existing : null;
  const addonRoot = existing?.type === 'addon' ? existing : null;
  const [kinds] = useState<SourceKind[]>(() => libraryKinds());
  const [kind, setKind] = useState<Kind>(
    addonRoot
      ? addonKind(addonRoot.addonUrl)
      : existing && existing.type !== 'addon'
        ? existing.type
        : 'webdav',
  );
  const addonUrl = kind.startsWith('addon:') ? kind.slice('addon:'.length) : null;
  const chosenSource = addonUrl ? (kinds.find((k) => k.url === addonUrl) ?? null) : null;
  const labelOf = (k: Kind) =>
    k.startsWith('addon:')
      ? (kinds.find((s) => addonKind(s.url) === k)?.manifest.name ?? k)
      : KIND_LABEL[k as BuiltIn];
  // An add-on's form: the plain fields come back when the login is entered again.
  const [values, setValues] = useState<Settings>(() => ({ ...(addonRoot?.settings ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [url, setUrlValue] = useState(dav?.url ?? jf?.url ?? abs?.url ?? '');
  const [username, setUsernameValue] = useState(dav?.username ?? jf?.username ?? '');
  const [password, setPasswordValue] = useState('');
  // Jellyfin: signed in after "Test connection", then the libraries to take books from.
  const [deviceId] = useState(() => jf?.deviceId ?? newId());
  const [signedIn, setSignedIn] = useState<SignedIn | null>(null);
  const [picked, setPicked] = useState<Set<string>>(
    new Set(jf?.libraryIds ?? abs?.libraryIds ?? []),
  );
  // Audiobookshelf: the same two steps, with an API key instead of a password.
  const [absSignedIn, setAbsSignedIn] = useState<AbsSignedIn | null>(null);
  const [apiKey, setApiKeyValue] = useState('');
  // A changed address or login needs a new test.
  const setUrl = (v: string) => {
    setUrlValue(v);
    setSignedIn(null);
    setAbsSignedIn(null);
  };
  const setUsername = (v: string) => {
    setUsernameValue(v);
    setSignedIn(null);
  };
  const setPassword = (v: string) => {
    setPasswordValue(v);
    setSignedIn(null);
  };
  const setApiKey = (v: string) => {
    setApiKeyValue(v);
    setAbsSignedIn(null);
  };
  const [endpoint, setEndpoint] = useState(s3?.endpoint ?? '');
  const [region, setRegion] = useState(s3?.region ?? 'auto');
  const [bucket, setBucket] = useState(s3?.bucket ?? '');
  const [prefix, setPrefix] = useState(s3?.prefix ?? '');
  const [accessKeyId, setAccessKeyId] = useState(s3?.accessKeyId ?? '');
  const [secretAccessKey, setSecret] = useState('');
  const locked = existing !== null;

  const testJellyfin = async () => {
    setBusy(true);
    try {
      const login = { url: url.trim(), username: username.trim(), password, deviceId };
      const { userId, token } = await signInJellyfin((u, i) => fetch(u, i), login);
      const libraries = await listJellyfinLibraries((u, i) => fetch(u, i), {
        ...login,
        userId,
        token,
      });
      setSignedIn({ userId, token, libraries });
      // Book libraries are picked to begin with; music libraries only when the user says so.
      if (!jf) setPicked(new Set(libraries.filter((l) => l.kind === 'books').map((l) => l.id)));
    } catch (error) {
      showAlert(t('Could not connect'), reason(error, 'Jellyfin'));
    } finally {
      setBusy(false);
    }
  };

  const testAudiobookshelf = async () => {
    setBusy(true);
    try {
      const fetcher = (u: string, i?: RequestInit) => fetch(u, i);
      const address = url.trim();
      // The key is sent as it is; the server refuses it once it expires or is turned off.
      const key = apiKey.trim();
      const me = await audiobookshelfMe(fetcher, address, key);
      const libraries = await listAudiobookshelfLibraries(fetcher, address, key);
      setAbsSignedIn({ userId: me.id, username: me.username ?? '', libraries });
      if (!abs) setPicked(new Set(libraries.map((l) => l.id)));
    } catch (error) {
      showAlert(t('Could not connect'), reason(error, 'Audiobookshelf'));
    } finally {
      setBusy(false);
    }
  };

  const source = (): RemoteSource =>
    kind === 'webdav'
      ? { type: 'webdav', url: url.trim(), username: username.trim(), password }
      : kind === 'jellyfin'
        ? {
            type: 'jellyfin',
            url: url.trim(),
            username: username.trim(),
            userId: signedIn?.userId ?? '',
            deviceId,
            token: signedIn?.token ?? '',
            libraryIds: [...picked].filter((id) => signedIn?.libraries.some((l) => l.id === id)),
            profileId: jf?.profileId ?? profileId,
          }
        : kind === 'audiobookshelf'
          ? {
              type: 'audiobookshelf',
              url: url.trim(),
              username: absSignedIn?.username ?? '',
              userId: absSignedIn?.userId ?? '',
              token: apiKey.trim(),
              libraryIds: [...picked].filter((id) =>
                absSignedIn?.libraries.some((l) => l.id === id),
              ),
              profileId: abs?.profileId ?? profileId,
            }
          : {
              type: 's3',
              endpoint: endpoint.trim(),
              region: region.trim() || 'auto',
              bucket: bucket.trim(),
              prefix: prefix.trim().replace(/^\/+/, ''),
              accessKeyId: accessKeyId.trim(),
              secretAccessKey,
            };

  const connectAddon = async (chosen: SourceKind) => {
    const read = readSettings(chosen.manifest.settings ?? [], values);
    if ('error' in read) {
      showAlert(t('Could not connect'), read.error);
      return;
    }
    setBusy(true);
    const code = codeFingerprint(chosen.url);
    const key = addonRoot?.key ?? newId();
    // A sandbox of its own for the check, so nothing of a server not yet added stays running.
    const sandboxId = `check-${key}`;
    try {
      // One listing checks the address and the login before anything is saved.
      const listing = await listAddonLibrary({
        addonUrl: chosen.url,
        manifest: chosen.manifest,
        sandboxId,
        settings: read.settings,
      });
      const remote = addonSource({
        addonUrl: chosen.url,
        manifest: chosen.manifest,
        key,
        settings: read.settings,
        ...(listing.headers ? { headers: listing.headers } : {}),
        ...(listing.query ? { query: listing.query } : {}),
        // The login is for this file; another one under the same ID has to ask again.
        ...(code ? { codeSha: code } : {}),
        // Places on the server belong to the profile that adds it, as with Jellyfin.
        profileId: addonRoot?.profileId ?? profileId,
      });
      if (existing && rootId) updateRemoteRoot(db, rootId, remote, Date.now());
      else addRemoteRoot(db, remote, Date.now(), newId);
      void scanLibrary().finally(refresh);
      refresh();
      showAlert(
        t('Connected'),
        t('{n} files found. Books appear as the scan reads them.', { n: listing.files.length }),
      );
      router.back();
    } catch (error) {
      showAlert(t('Could not connect'), reason(error, chosen.manifest.name));
    } finally {
      closeSandbox(`${chosen.url}#${sandboxId}`);
      setBusy(false);
    }
  };

  const connect = async () => {
    if (chosenSource) {
      await connectAddon(chosenSource);
      return;
    }
    setBusy(true);
    try {
      const remote = source();
      // One request checks the address and the login before anything is saved: the WebDAV
      // folder entered, or the bucket's listing. Jellyfin was checked by "Test connection".
      if (remote.type === 'webdav') await checkWebdav((u, i) => fetch(u, i), remote);
      const files =
        remote.type === 's3' ? await listS3((u, i) => fetch(u, i), remote, Date.now()) : null;
      if (existing && rootId) updateRemoteRoot(db, rootId, remote, Date.now());
      else addRemoteRoot(db, remote, Date.now(), newId);
      void scanLibrary().finally(refresh);
      refresh();
      showAlert(
        t('Connected'),
        files
          ? t('{n} files found. Books appear as the scan reads them.', { n: files.length })
          : remote.type === 'webdav'
            ? t('Books appear as the scan reads the folders.')
            : t('Books appear as the scan reads the libraries.'),
      );
      router.back();
    } catch (error) {
      showAlert(t('Could not connect'), reason(error, labelOf(kind)));
    } finally {
      setBusy(false);
    }
  };

  const ready = chosenSource
    ? (chosenSource.manifest.settings ?? []).every(
        (f) => !f.required || (values[f.key] ?? '').trim() !== '',
      )
    : kind === 'webdav'
      ? /^https?:\/\//.test(url.trim())
      : kind === 'jellyfin'
        ? /^https?:\/\//.test(url.trim()) && username.trim() !== ''
        : kind === 'audiobookshelf'
          ? /^https?:\/\//.test(url.trim()) && apiKey.trim() !== ''
          : /^https?:\/\//.test(endpoint.trim()) &&
            bucket.trim() !== '' &&
            accessKeyId.trim() !== '';
  // Jellyfin and Audiobookshelf connect in two steps: test the login, then pick libraries.
  const testing = (kind === 'jellyfin' && !signedIn) || (kind === 'audiobookshelf' && !absSignedIn);
  const canConnect =
    ready &&
    (kind === 'jellyfin'
      ? signedIn !== null && picked.size > 0
      : kind === 'audiobookshelf'
        ? absSignedIn !== null && picked.size > 0
        : true);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };

  return (
    <ScrollView
      className="flex-1 bg-night"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 16,
        paddingBottom: 32,
        gap: 16,
      }}
    >
      <View className="-ms-2 self-start">
        <IconButton
          name="back"
          label={t('Back')}
          color={COLORS.soft}
          onPress={() => router.back()}
        />
      </View>
      <Text accessibilityRole="header" className="text-3xl font-semibold text-paper">
        {abs ? t('Change key') : locked ? t('Log in again') : t('Add a server')}
      </Text>
      <Text className="text-soft">
        {abs
          ? t('Enter a new API key for this server. The server, its books and your places stay.')
          : locked
            ? t(
                'Passwords stay on the phone they were entered on and are not in backups. Enter it again; your books and places stay.',
              )
            : t(
                'Books on your own storage, played straight from it. The address and login stay on this device and are never synced.',
              )}
      </Text>

      <View className={`flex-row flex-wrap gap-2 ${locked ? 'hidden' : ''}`}>
        {[...BUILT_IN, ...kinds.map((k) => addonKind(k.url))].map((k) => (
          <Pill
            key={k}
            onPress={() => setKind(k)}
            accessibilityState={{ selected: kind === k }}
            aria-selected={kind === k}
            className={`rounded-full border px-4 py-2 ${kind === k ? 'border-amber bg-amber' : 'border-line'}`}
          >
            <Text className={kind === k ? 'text-ink' : 'text-soft'}>{labelOf(k)}</Text>
          </Pill>
        ))}
      </View>

      {addonUrl && !chosenSource ? (
        <Text className="text-muted">
          {t('The add-on for this server is no longer on this device.')}
        </Text>
      ) : chosenSource ? (
        <>
          <Text className="text-sm text-soft">{chosenSource.manifest.description}</Text>
          {(chosenSource.manifest.settings ?? []).map((field) => (
            <Field
              key={field.key}
              label={field.label}
              // The server's place stays when only the login is entered again.
              locked={locked && field.type !== 'password'}
              value={values[field.key] ?? ''}
              onChange={(v) => setValues((current) => ({ ...current, [field.key]: v }))}
              secret={field.type === 'password'}
              {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
              {...(field.help === undefined ? {} : { hint: field.help })}
            />
          ))}
          {offersPlaces(chosenSource.manifest) && (
            <Text className="text-xs text-muted">
              {t('Places sync both ways with this server, for the profile adding it.')}
            </Text>
          )}
          <Text className="text-xs text-muted">
            {t(
              'Runs on this device, in a sandbox. It can reach only the address you enter, and the login stays on this device.',
            )}
          </Text>
          {Platform.OS === 'web' && (
            <Text className="text-sm text-muted">
              {t(
                "In the browser the server must allow this site (CORS), and some servers' books play in the Android app only: a browser can't send a login with audio.",
              )}
            </Text>
          )}
        </>
      ) : kind === 'jellyfin' ? (
        <>
          <Field
            label={t('Server address')}
            locked={locked}
            value={url}
            onChange={setUrl}
            placeholder={'https://jellyfin.example.org'}
            hint={t('The address you open Jellyfin at, with its path if it has one.')}
          />
          <Field label={t('Username')} value={username} onChange={setUsername} />
          <Field
            label={t('Password')}
            value={password}
            onChange={setPassword}
            secret
            hint={t(
              "Used once to sign in. Lelap keeps the server's token, not the password, and plays the original files.",
            )}
          />
          {signedIn && (
            <View className="gap-2">
              <Text className="text-sm text-soft">{t('Libraries')}</Text>
              {signedIn.libraries.length === 0 ? (
                <Text className="text-muted">
                  {t('This account has no book or music libraries on the server.')}
                </Text>
              ) : (
                signedIn.libraries.map((library) => (
                  <LibrarySwitch
                    key={library.id}
                    name={library.name}
                    detail={library.kind === 'books' ? t('Books') : t('Music')}
                    on={picked.has(library.id)}
                    onChange={(on) => toggle(library.id, on)}
                  />
                ))
              )}
              <Text className="text-xs text-muted">
                {t(
                  'Places sync both ways with this Jellyfin user, for the profile adding the server.',
                )}
              </Text>
            </View>
          )}
          {Platform.OS === 'web' && (
            <Text className="text-sm text-muted">
              {t('In the browser the Jellyfin server must allow this site (CORS headers).')}
            </Text>
          )}
        </>
      ) : kind === 'audiobookshelf' ? (
        <>
          <Field
            label={t('Server address')}
            locked={locked}
            value={url}
            onChange={setUrl}
            placeholder={'https://abs.example.org'}
            hint={t('The address you open Audiobookshelf at, with its path if it has one.')}
          />
          <Field
            label={t('API key')}
            value={apiKey}
            onChange={setApiKey}
            secret
            hint={t(
              'Make one in Audiobookshelf under Settings → API Keys. Audiobookshelf 2.26 or later; older servers are not supported.',
            )}
          />
          {absSignedIn && (
            <View className="gap-2">
              <Text className="text-sm text-soft">{t('Libraries')}</Text>
              {absSignedIn.libraries.length === 0 ? (
                <Text className="text-muted">
                  {t('This account has no book libraries on the server.')}
                </Text>
              ) : (
                absSignedIn.libraries.map((library) => (
                  <LibrarySwitch
                    key={library.id}
                    name={library.name}
                    on={picked.has(library.id)}
                    onChange={(on) => toggle(library.id, on)}
                  />
                ))
              )}
              <Text className="text-xs text-muted">
                {t(
                  'Places sync both ways with this Audiobookshelf user, for the profile adding the server.',
                )}
              </Text>
            </View>
          )}
          {Platform.OS === 'web' && (
            <Text className="text-sm text-muted">
              {t('In the browser the Audiobookshelf server must allow this site (CORS headers).')}
            </Text>
          )}
        </>
      ) : kind === 'webdav' ? (
        <>
          <Field
            label={t('Folder address')}
            locked={locked}
            value={url}
            onChange={setUrl}
            placeholder={'https://cloud.example.org/remote.php/dav/files/me/Audiobooks'}
            hint={t(
              'Nextcloud and ownCloud: Files → Settings → WebDAV shows the address; add your audiobooks folder.',
            )}
          />
          <Field label={t('Username')} value={username} onChange={setUsername} />
          <Field
            label={t('Password')}
            value={password}
            onChange={setPassword}
            secret
            hint={t('An app password is best: it can be revoked without changing your own.')}
          />
          {Platform.OS === 'web' && (
            <Text className="text-sm text-muted">
              {t(
                "In the browser the server must allow this site (CORS), and WebDAV books play in the Android app only: a browser can't send the login with audio.",
              )}
            </Text>
          )}
        </>
      ) : (
        <>
          <Field
            label={t('Endpoint')}
            locked={locked}
            value={endpoint}
            onChange={setEndpoint}
            placeholder={'https://<account>.r2.cloudflarestorage.com'}
            hint={'AWS, Cloudflare R2, Backblaze B2, Wasabi, MinIO, Garage, …'}
          />
          <Field
            label={t('Region')}
            locked={locked}
            value={region}
            onChange={setRegion}
            hint={t('“auto” for R2; the bucket’s region elsewhere.')}
          />
          <Field label={t('Bucket')} locked={locked} value={bucket} onChange={setBucket} />
          <Field
            label={t('Folder in the bucket (optional)')}
            locked={locked}
            value={prefix}
            onChange={setPrefix}
            placeholder={'audiobooks/'}
          />
          <Field
            label={t('Access key ID')}
            value={accessKeyId}
            onChange={setAccessKeyId}
            hint={t('A read-only key is enough.')}
          />
          <Field
            label={t('Secret access key')}
            value={secretAccessKey}
            onChange={setSecret}
            secret
          />
        </>
      )}

      <Pressable
        disabled={(testing ? !ready : !canConnect) || busy}
        onPress={() =>
          void (testing
            ? kind === 'audiobookshelf'
              ? testAudiobookshelf()
              : testJellyfin()
            : connect())
        }
        accessibilityRole="button"
        {...(busy ? { accessibilityLabel: testing ? t('Test connection') : t('Connect') } : {})}
        className={`min-h-12 items-center justify-center rounded-full py-3 ${(testing ? ready : canConnect) ? 'bg-amber active:opacity-80' : 'bg-raised'}`}
      >
        {busy ? (
          <ActivityIndicator color="#1a1305" />
        ) : (
          <Text
            className={`font-semibold ${(testing ? ready : canConnect) ? 'text-ink' : 'text-muted'}`}
          >
            {testing ? t('Test connection') : t('Connect')}
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
