import {
  addRemoteRoot,
  listRoots,
  listS3,
  listWebdav,
  type RemoteSource,
  updateRemoteRoot,
} from '@lelap/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db, newId } from '../src/db';
import { useLibrary } from '../src/player';
import { scanLibrary } from '../src/scan';

type Kind = 'webdav' | 's3';

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

/** Adds a WebDAV server or an S3-compatible bucket as a place where books live. */
export default function ServerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh } = useLibrary();
  // `?root=` enters the login again for a server whose password this phone can't open.
  const { root: rootId } = useLocalSearchParams<{ root?: string }>();
  const [existing] = useState(() => listRoots(db).find((r) => r.id === rootId)?.remote ?? null);
  const dav = existing?.type === 'webdav' ? existing : null;
  const s3 = existing?.type === 's3' ? existing : null;
  const [kind, setKind] = useState<Kind>(existing?.type ?? 'webdav');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(dav?.url ?? '');
  const [username, setUsername] = useState(dav?.username ?? '');
  const [password, setPassword] = useState('');
  const [endpoint, setEndpoint] = useState(s3?.endpoint ?? '');
  const [region, setRegion] = useState(s3?.region ?? 'auto');
  const [bucket, setBucket] = useState(s3?.bucket ?? '');
  const [prefix, setPrefix] = useState(s3?.prefix ?? '');
  const [accessKeyId, setAccessKeyId] = useState(s3?.accessKeyId ?? '');
  const [secretAccessKey, setSecret] = useState('');
  const locked = existing !== null;

  const source = (): RemoteSource =>
    kind === 'webdav'
      ? { type: 'webdav', url: url.trim(), username: username.trim(), password }
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
      const files =
        remote.type === 'webdav'
          ? await listWebdav((u, i) => fetch(u, i), remote)
          : await listS3((u, i) => fetch(u, i), remote, Date.now());
      if (existing && rootId) updateRemoteRoot(db, rootId, remote, Date.now());
      else addRemoteRoot(db, remote, Date.now(), newId);
      void scanLibrary().finally(refresh);
      refresh();
      Alert.alert('Connected', `${files.length} files found. Books appear as the scan reads them.`);
      router.back();
    } catch (error) {
      Alert.alert('Could not connect', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const ready =
    kind === 'webdav'
      ? /^https?:\/\//.test(url.trim())
      : /^https?:\/\//.test(endpoint.trim()) && bucket.trim() !== '' && accessKeyId.trim() !== '';

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
      <Pressable onPress={() => router.back()} hitSlop={12} className="self-start py-2">
        <Text className="text-2xl text-muted">‹</Text>
      </Pressable>
      <Text className="text-3xl font-semibold text-paper">
        {locked ? 'Log in again' : 'Add a server'}
      </Text>
      <Text className="text-soft">
        {locked
          ? 'Passwords stay on the phone they were entered on and are not in backups. Enter it again; your books and places stay.'
          : 'Books on your own storage, played straight from it. The address and login stay on this device and are never synced.'}
      </Text>

      <View className={`flex-row gap-2 ${locked ? 'hidden' : ''}`}>
        {(['webdav', 's3'] as const).map((k) => (
          <Pressable
            key={k}
            onPress={() => setKind(k)}
            className={`rounded-full border px-4 py-2 ${kind === k ? 'border-amber bg-amber' : 'border-line'}`}
          >
            <Text className={kind === k ? 'text-ink' : 'text-soft'}>
              {k === 'webdav' ? 'WebDAV' : 'S3-compatible'}
            </Text>
          </Pressable>
        ))}
      </View>

      {kind === 'webdav' ? (
        <>
          <Field
            label="Folder address"
            locked={locked}
            value={url}
            onChange={setUrl}
            placeholder="https://cloud.example.org/remote.php/dav/files/me/Audiobooks"
            hint="Nextcloud and ownCloud: Files → Settings → WebDAV shows the address; add your audiobooks folder."
          />
          <Field label="Username" value={username} onChange={setUsername} />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            secret
            hint="An app password is best: it can be revoked without changing your own."
          />
          {Platform.OS === 'web' && (
            <Text className="text-sm text-muted">
              In the browser the server must allow this site (CORS), and WebDAV books play in the
              Android app only: a browser can't send the login with audio.
            </Text>
          )}
        </>
      ) : (
        <>
          <Field
            label="Endpoint"
            locked={locked}
            value={endpoint}
            onChange={setEndpoint}
            placeholder="https://<account>.r2.cloudflarestorage.com"
            hint="AWS, Cloudflare R2, Backblaze B2, Wasabi, MinIO, Garage, …"
          />
          <Field
            label="Region"
            locked={locked}
            value={region}
            onChange={setRegion}
            hint="“auto” for R2; the bucket’s region elsewhere."
          />
          <Field label="Bucket" locked={locked} value={bucket} onChange={setBucket} />
          <Field
            label="Folder in the bucket (optional)"
            locked={locked}
            value={prefix}
            onChange={setPrefix}
            placeholder="audiobooks/"
          />
          <Field
            label="Access key ID"
            value={accessKeyId}
            onChange={setAccessKeyId}
            hint="A read-only key is enough."
          />
          <Field label="Secret access key" value={secretAccessKey} onChange={setSecret} secret />
        </>
      )}

      <Pressable
        disabled={!ready || busy}
        onPress={() => void connect()}
        className={`items-center rounded-full py-3 ${ready ? 'bg-amber active:opacity-80' : 'bg-raised'}`}
      >
        {busy ? (
          <ActivityIndicator color="#1a1305" />
        ) : (
          <Text className={`font-semibold ${ready ? 'text-ink' : 'text-muted'}`}>Connect</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
