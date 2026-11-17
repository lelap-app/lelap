import {
  addRemoteRoot,
  type JellyfinLibrary,
  listJellyfinLibraries,
  listRoots,
  listS3,
  listWebdav,
  RemoteError,
  type RemoteSource,
  signInJellyfin,
  updateRemoteRoot,
} from '@lelap/core';
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

type Kind = 'webdav' | 's3' | 'jellyfin';

const KIND_LABEL: Record<Kind, string> = {
  webdav: 'WebDAV',
  s3: t('S3-compatible'),
  jellyfin: 'Jellyfin',
};

/** Why a server could not be reached, with what a browser adds to it. */
function reason(error: unknown, kind: Kind): string {
  const message = error instanceof Error ? error.message : String(error);
  if (Platform.OS === 'web' && error instanceof RemoteError && error.status === 0) {
    return `${message}\n\nIn the browser the ${KIND_LABEL[kind]} server must allow this site (CORS headers), and an http:// server can't be reached from an https:// page. The Android app has neither limit.`;
  }
  return message;
}

type SignedIn = { userId: string; token: string; libraries: JellyfinLibrary[] };

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

/** Adds a WebDAV server, an S3-compatible bucket or a Jellyfin server as a place where books live. */
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
  const [kind, setKind] = useState<Kind>(existing?.type ?? 'webdav');
  const [busy, setBusy] = useState(false);
  const [url, setUrlValue] = useState(dav?.url ?? jf?.url ?? '');
  const [username, setUsernameValue] = useState(dav?.username ?? jf?.username ?? '');
  const [password, setPasswordValue] = useState('');
  // Jellyfin: signed in after "Test connection", then the libraries to take books from.
  const [deviceId] = useState(() => jf?.deviceId ?? newId());
  const [signedIn, setSignedIn] = useState<SignedIn | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(jf?.libraryIds ?? []));
  // A changed address or login needs a new test.
  const setUrl = (v: string) => {
    setUrlValue(v);
    setSignedIn(null);
  };
  const setUsername = (v: string) => {
    setUsernameValue(v);
    setSignedIn(null);
  };
  const setPassword = (v: string) => {
    setPasswordValue(v);
    setSignedIn(null);
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
      showAlert(t('Could not connect'), reason(error, 'jellyfin'));
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
        : {
            type: 's3',
            endpoint: endpoint.trim(),
            region: region.trim() || 'auto',
            bucket: bucket.trim(),
            prefix: prefix.trim().replace(/^\/+/, ''),
            accessKeyId: accessKeyId.trim(),
            secretAccessKey,
          };

  const connect = async () => {
    setBusy(true);
    try {
      const remote = source();
      // Reading the listing once checks the address and the login before anything is saved.
      // Jellyfin was checked by "Test connection".
      const files =
        remote.type === 'webdav'
          ? await listWebdav((u, i) => fetch(u, i), remote)
          : remote.type === 's3'
            ? await listS3((u, i) => fetch(u, i), remote, Date.now())
            : null;
      if (existing && rootId) updateRemoteRoot(db, rootId, remote, Date.now());
      else addRemoteRoot(db, remote, Date.now(), newId);
      void scanLibrary().finally(refresh);
      refresh();
      showAlert(
        t('Connected'),
        files
          ? t('{n} files found. Books appear as the scan reads them.', { n: files.length })
          : t('Books appear as the scan reads the libraries.'),
      );
      router.back();
    } catch (error) {
      showAlert(t('Could not connect'), reason(error, kind));
    } finally {
      setBusy(false);
    }
  };

  const ready =
    kind === 'webdav'
      ? /^https?:\/\//.test(url.trim())
      : kind === 'jellyfin'
        ? /^https?:\/\//.test(url.trim()) && username.trim() !== ''
        : /^https?:\/\//.test(endpoint.trim()) && bucket.trim() !== '' && accessKeyId.trim() !== '';
  // Jellyfin connects in two steps: test the login, then pick libraries.
  const testing = kind === 'jellyfin' && !signedIn;
  const canConnect = ready && (kind !== 'jellyfin' || (signedIn !== null && picked.size > 0));

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
      <View className="-ml-2 self-start">
        <IconButton
          name="back"
          label={t('Back')}
          color={COLORS.soft}
          onPress={() => router.back()}
        />
      </View>
      <Text className="text-3xl font-semibold text-paper">
        {locked ? t('Log in again') : t('Add a server')}
      </Text>
      <Text className="text-soft">
        {locked
          ? t(
              'Passwords stay on the phone they were entered on and are not in backups. Enter it again; your books and places stay.',
            )
          : t(
              'Books on your own storage, played straight from it. The address and login stay on this device and are never synced.',
            )}
      </Text>

      <View className={`flex-row gap-2 ${locked ? 'hidden' : ''}`}>
        {(['webdav', 's3', 'jellyfin'] as const).map((k) => (
          <Pressable
            key={k}
            onPress={() => setKind(k)}
            className={`rounded-full border px-4 py-2 ${kind === k ? 'border-amber bg-amber' : 'border-line'}`}
          >
            <Text className={kind === k ? 'text-ink' : 'text-soft'}>{KIND_LABEL[k]}</Text>
          </Pressable>
        ))}
      </View>

      {kind === 'jellyfin' ? (
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
                  <View key={library.id} className="flex-row items-center justify-between py-1">
                    <View className="flex-1">
                      <Text className="text-paper">{library.name}</Text>
                      <Text className="text-xs text-muted">
                        {library.kind === 'books' ? t('Books') : t('Music')}
                      </Text>
                    </View>
                    <Switch
                      value={picked.has(library.id)}
                      onValueChange={(on) => {
                        const next = new Set(picked);
                        if (on) next.add(library.id);
                        else next.delete(library.id);
                        setPicked(next);
                      }}
                    />
                  </View>
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
        onPress={() => void (testing ? testJellyfin() : connect())}
        className={`items-center rounded-full py-3 ${(testing ? ready : canConnect) ? 'bg-amber active:opacity-80' : 'bg-raised'}`}
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
