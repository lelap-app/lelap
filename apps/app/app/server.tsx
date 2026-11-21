import {
  AddressBook,
  addonSettings,
  addonSource,
  addonSourceHosts,
  addRemoteRoot,
  type AudiobookshelfLibrary,
  audiobookshelfMe,
  checkWebdav,
  type JellyfinLibrary,
  listAudiobookshelfLibraries,
  listJellyfinLibraries,
  listRoots,
  isLocalAddress,
  listS3,
  netfsHeaders,
  netRootUri,
  parseNetAddress,
  RemoteError,
  type RemoteSource,
  sftpSecretJson,
  signInJellyfin,
  takesSecondAddress,
  tryAddresses,
  updateRemoteRoot,
} from '@lelap/core';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { applySignin, offersPlaces, readSettings, type Settings } from '@lelap/sdk';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hint as hintProps } from '../src/a11y';
import { t } from '../src/i18n';
import { showAlert } from '../src/dialog';
import { Button } from '../src/components/Button';
import { EmptyState } from '../src/components/EmptyState';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { TextField } from '../src/components/TextField';
import { db, newId } from '../src/db';
import { useLibrary } from '../src/player';
import { profileId } from '../src/profile';
import { scanLibrary } from '../src/scan';
import { addressesSaved, serversChanged } from '../src/addresses';
import { Pill } from '../src/components/Pill';
import {
  codeFingerprint,
  libraryKinds,
  listAddonLibrary,
  type SourceKind,
} from '../src/addonSources';
import { callAddonSettings, closeSandbox } from '../src/sandbox';
import { AddonChoice, useChoiceOptions } from '../src/components/AddonChoice';
import { AddonSignin } from '../src/components/AddonSignin';
import { TextButton, Toggle } from '../src/components/TextButton';
import { askLocalNetwork, withLocalNetworkCause } from '../src/localNetwork';
import { netServerReason } from '../src/netServers';
import {
  check as checkNetServer,
  type HostKey,
  hostKey as askHostKey,
  NETFS,
} from '../src/platform/netfs';
import { READABLE } from '../src/layout';

type BuiltIn = 'webdav' | 'smb' | 'sftp' | 's3' | 'jellyfin' | 'audiobookshelf';
/** A built-in kind, or an add-on inside the app by its manifest URL (M57). */
type Kind = BuiltIn | `addon:${string}`;

const KIND_LABEL: Record<BuiltIn, string> = {
  webdav: 'WebDAV',
  smb: 'SMB',
  sftp: 'SFTP',
  s3: t('S3-compatible'),
  jellyfin: 'Jellyfin',
  audiobookshelf: 'Audiobookshelf',
};

const BUILT_IN: BuiltIn[] = ['webdav', 'smb', 'sftp', 's3', 'jellyfin', 'audiobookshelf'];

const addonKind = (url: string): Kind => `addon:${url}`;

/** Why a server could not be reached, with what a browser adds to it. */
function reason(error: unknown, label: string): string {
  if (label === 'SMB' || label === 'SFTP') return netServerReason(error);
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
        {detail && <Text className="text-caption text-muted">{detail}</Text>}
      </View>
      <Toggle accessibilityLabel={name} value={on} onValueChange={onChange} />
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
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secret?: boolean;
  /** A pasted private key. */
  multiline?: boolean;
  /** Shown but not editable: the server's place when only the login is entered again. */
  locked?: boolean;
  hint?: string;
}) {
  return (
    <View className="gap-1">
      <Text className="text-detail text-soft">{label}</Text>
      <TextField
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        accessibilityLabel={label}
        {...hintProps(hint)}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secret}
        locked={locked}
        multiline={multiline}
        mono={multiline}
        {...(multiline ? { numberOfLines: 4, textAlignVertical: 'top' as const } : {})}
        className={multiline ? 'min-h-24' : ''}
      />
      {hint && <Text className="text-caption text-muted">{hint}</Text>}
    </View>
  );
}

/**
 * A second address for the same server (M146), such as the public one beside the home one;
 * folded away, so a server with one address looks as before.
 */
function AlsoReachable({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(value !== '');
  if (!open) {
    return (
      <TextButton
        text={t('Also reachable at')}
        onPress={() => setOpen(true)}
        className="self-start"
      />
    );
  }
  return (
    <Field
      label={t('Also reachable at')}
      value={value}
      onChange={onChange}
      placeholder={'http://192.168.1.10'}
      hint={t(
        'Another address of the same server, such as its home address beside the public one. Lelap uses whichever answers and keeps one login for both.',
      )}
    />
  );
}

const isHttp = (url: string) => /^https?:\/\//.test(url.trim());

/** Adds a WebDAV server, an S3-compatible bucket, or a Jellyfin or Audiobookshelf server. */
export default function ServerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh } = useLibrary();
  // `?root=` enters the login again for a server whose password this phone can't open; `?addon=`
  // opens the form of an add-on inside the app, such as OPDS from Lelap's own add-ons.
  // `?root=…&addresses=1` changes only the server's second address, with no login asked.
  const {
    root: rootId,
    addon: chosenAddon,
    addresses: addressesOnly,
  } = useLocalSearchParams<{
    root?: string;
    addon?: string;
    addresses?: string;
  }>();
  const [existing] = useState(() => listRoots(db).find((r) => r.id === rootId)?.remote ?? null);
  const dav = existing?.type === 'webdav' ? existing : null;
  const smb = existing?.type === 'smb' ? existing : null;
  const sftp = existing?.type === 'sftp' ? existing : null;
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
        : chosenAddon && kinds.some((k) => k.url === chosenAddon)
          ? addonKind(chosenAddon)
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
  // The server's key, and the sandbox that signs in and checks it before it is added.
  const [serverKey] = useState(() => addonRoot?.key ?? newId());
  const checkSandbox = `check-${serverKey}`;
  useEffect(
    () => () => {
      for (const k of kinds) closeSandbox(`${k.url}#check-${serverKey}`);
    },
    [kinds, serverKey],
  );
  const [busy, setBusy] = useState(false);
  const [alsoUrl, setAlsoUrlValue] = useState(dav?.alsoUrl ?? jf?.alsoUrl ?? abs?.alsoUrl ?? '');
  const [url, setUrlValue] = useState(
    dav?.url ?? smb?.url ?? sftp?.url ?? jf?.url ?? abs?.url ?? '',
  );
  const [username, setUsernameValue] = useState(
    dav?.username ?? smb?.username ?? sftp?.username ?? jf?.username ?? '',
  );
  // SFTP: the server's key, shown before any login is sent; the one stored when logging in again.
  const [hostKey, setHostKey] = useState<HostKey | null>(
    sftp ? { fingerprint: sftp.hostKey, algorithm: '' } : null,
  );
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
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
    setHostKey(null);
  };
  const setAlsoUrl = (v: string) => {
    setAlsoUrlValue(v);
    setSignedIn(null);
    setAbsSignedIn(null);
  };
  // Both addresses for a test: the one entered first, then the other on a connection error.
  const testBook = useState(() => new AddressBook())[0];
  const atEither = <T,>(request: (address: string) => Promise<T>): Promise<T> =>
    tryAddresses(
      testBook,
      'form',
      [url.trim(), alsoUrl.trim()].filter((a) => a !== ''),
      request,
    );
  const also = (): { alsoUrl?: string } => (alsoUrl.trim() ? { alsoUrl: alsoUrl.trim() } : {});
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
  // Choice fields' options (revision 11), asked in the sandbox that checks the server.
  const choices = useChoiceOptions(chosenSource?.manifest ?? null, null, (settings) =>
    callAddonSettings({
      addonUrl: chosenSource?.url ?? '',
      sandboxId: `options-${serverKey}`,
      hosts: chosenSource ? addonSourceHosts(chosenSource.manifest, settings) : [],
      settings: { ...(addonRoot ? addonSettings(addonRoot) : {}), ...settings },
    }),
  );

  // Whether the address in the form is on the local network (Android 17 asks for access first).
  const formIsLocal = (): boolean => {
    if (chosenSource) {
      return addonSourceHosts(chosenSource.manifest, values).some(isLocalAddress);
    }
    return isLocalAddress(kind === 's3' ? endpoint : url) || isLocalAddress(alsoUrl);
  };
  // A failed connection, with missing local network access named when it may be the cause.
  const couldNotConnect = async (message: string) =>
    showAlert(t('Could not connect'), await withLocalNetworkCause(message, formIsLocal()));

  const testJellyfin = async () => {
    setBusy(true);
    try {
      const { userId, token, libraries } = await atEither(async (address) => {
        const login = { url: address, username: username.trim(), password, deviceId };
        const signed = await signInJellyfin((u, i) => fetch(u, i), login);
        const found = await listJellyfinLibraries((u, i) => fetch(u, i), { ...login, ...signed });
        return { ...signed, libraries: found };
      });
      setSignedIn({ userId, token, libraries });
      // Book libraries are picked to begin with; music libraries only when the user says so.
      if (!jf) setPicked(new Set(libraries.filter((l) => l.kind === 'books').map((l) => l.id)));
    } catch (error) {
      await couldNotConnect(reason(error, 'Jellyfin'));
    } finally {
      setBusy(false);
    }
  };

  const testAudiobookshelf = async () => {
    setBusy(true);
    try {
      const fetcher = (u: string, i?: RequestInit) => fetch(u, i);
      // The key is sent as it is; the server refuses it once it expires or is turned off.
      const key = apiKey.trim();
      const { me, libraries } = await atEither(async (address) => ({
        me: await audiobookshelfMe(fetcher, address, key),
        libraries: await listAudiobookshelfLibraries(fetcher, address, key),
      }));
      setAbsSignedIn({ userId: me.id, username: me.username ?? '', libraries });
      if (!abs) setPicked(new Set(libraries.map((l) => l.id)));
    } catch (error) {
      await couldNotConnect(reason(error, 'Audiobookshelf'));
    } finally {
      setBusy(false);
    }
  };

  const testSftp = async () => {
    setBusy(true);
    try {
      // Only the handshake: no login goes to a server whose key is not yet trusted.
      const uri = netRootUri({
        type: 'sftp',
        url: url.trim(),
        username: '',
        hostKey: '',
        secret: '',
      });
      setHostKey(await askHostKey(uri));
    } catch (error) {
      await couldNotConnect(netServerReason(error));
    } finally {
      setBusy(false);
    }
  };

  const pickKeyFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return;
    const copy = new File(asset.uri);
    try {
      setPrivateKey((await copy.text()).trim());
    } catch (error) {
      showAlert(t('Could not read the file'), error instanceof Error ? error.message : '');
    } finally {
      // The picker's copy of the key does not stay in the cache.
      if (copy.exists) copy.delete();
    }
  };

  const source = (): RemoteSource =>
    kind === 'webdav'
      ? { type: 'webdav', url: url.trim(), ...also(), username: username.trim(), password }
      : kind === 'smb'
        ? { type: 'smb', url: url.trim(), username: username.trim(), password }
        : kind === 'sftp'
          ? {
              type: 'sftp',
              url: url.trim(),
              username: username.trim(),
              hostKey: hostKey?.fingerprint ?? '',
              secret: sftpSecretJson({
                ...(password ? { password } : {}),
                ...(privateKey.trim() ? { privateKey: `${privateKey.trim()}\n` } : {}),
                ...(privateKey.trim() && passphrase ? { passphrase } : {}),
              }),
            }
          : kind === 'jellyfin'
            ? {
                type: 'jellyfin',
                url: url.trim(),
                ...also(),
                username: username.trim(),
                userId: signedIn?.userId ?? '',
                deviceId,
                token: signedIn?.token ?? '',
                libraryIds: [...picked].filter((id) =>
                  signedIn?.libraries.some((l) => l.id === id),
                ),
                profileId: jf?.profileId ?? profileId,
              }
            : kind === 'audiobookshelf'
              ? {
                  type: 'audiobookshelf',
                  url: url.trim(),
                  ...also(),
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
    const key = serverKey;
    // A sandbox of its own for the check, so nothing of a server not yet added stays running.
    const sandboxId = checkSandbox;
    try {
      // One listing checks the address and the login before anything is saved.
      const listing = await listAddonLibrary({
        addonUrl: chosen.url,
        manifest: chosen.manifest,
        sandboxId,
        settings: read.settings,
        // The first page is enough to check the login; the scan lists the rest.
        maxPages: 1,
      });
      const remote = addonSource({
        addonUrl: chosen.url,
        manifest: chosen.manifest,
        key,
        settings: read.settings,
        ...(listing.headers ? { headers: listing.headers } : {}),
        ...(listing.query ? { query: listing.query } : {}),
        ...(listing.webQuery ? { webQuery: listing.webQuery } : {}),
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
      await couldNotConnect(reason(error, chosen.manifest.name));
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
      if (remote.type === 'webdav') {
        await atEither((address) =>
          checkWebdav((u, i) => fetch(u, i), { ...remote, url: address }),
        );
      }
      // SMB and SFTP: the folder entered, with the login and (SFTP) the key just shown.
      if (remote.type === 'smb' || remote.type === 'sftp') {
        await checkNetServer(netRootUri(remote), netfsHeaders(remote));
      }
      const files =
        remote.type === 's3' ? await listS3((u, i) => fetch(u, i), remote, Date.now()) : null;
      if (existing && rootId) updateRemoteRoot(db, rootId, remote, Date.now());
      else addRemoteRoot(db, remote, Date.now(), newId);
      serversChanged();
      void scanLibrary().finally(refresh);
      refresh();
      showAlert(
        t('Connected'),
        files
          ? t('{n} files found. Books appear as the scan reads them.', { n: files.length })
          : remote.type === 'webdav' || remote.type === 'smb' || remote.type === 'sftp'
            ? t('Books appear as the scan reads the folders.')
            : t('Books appear as the scan reads the libraries.'),
      );
      router.back();
    } catch (error) {
      await couldNotConnect(reason(error, labelOf(kind)));
    } finally {
      setBusy(false);
    }
  };

  // Only the second address changes: the server's login and its books stay as they are.
  const saveAddresses = () => {
    // Read again: a scan may have changed the server's state since the screen opened.
    const root = rootId ? listRoots(db).find((r) => r.id === rootId) : undefined;
    const current = root?.remote;
    if (!root || !rootId || root.needsLogin || !takesSecondAddress(current)) return;
    const next = { ...current, ...also() };
    if (!alsoUrl.trim()) delete next.alsoUrl;
    updateRemoteRoot(db, rootId, next, Date.now());
    // Asked at once, so the next stream goes where the server answers.
    addressesSaved(rootId);
    refresh();
    router.back();
  };
  const alsoOk = alsoUrl.trim() === '' || isHttp(alsoUrl);

  if (addressesOnly && (dav || jf || abs)) {
    return (
      <ScrollView
        className="flex-1 bg-night"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          ...READABLE,
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 32,
          gap: 16,
        }}
      >
        <ScreenHeader
          inGap
          title={t('Addresses')}
          subtitle={t(
            'A server you reach at home and from outside can have both addresses. Lelap uses whichever answers; the login, books and places stay.',
          )}
        />
        <Field label={t('Server address')} locked value={url} onChange={setUrl} />
        <AlsoReachable value={alsoUrl} onChange={setAlsoUrl} />
        <Button text={t('Save')} onPress={saveAddresses} disabled={!alsoOk} />
      </ScrollView>
    );
  }

  const ready = chosenSource
    ? (chosenSource.manifest.settings ?? []).every(
        (f) => !f.required || (values[f.key] ?? '').trim() !== '',
      )
    : !alsoOk && (kind === 'webdav' || kind === 'jellyfin' || kind === 'audiobookshelf')
      ? false
      : kind === 'webdav'
        ? /^https?:\/\//.test(url.trim())
        : kind === 'smb' || kind === 'sftp'
          ? NETFS &&
            parseNetAddress(url)?.scheme === kind &&
            (kind === 'smb' ||
              (username.trim() !== '' && (password !== '' || privateKey.trim() !== '')))
          : kind === 'jellyfin'
            ? /^https?:\/\//.test(url.trim()) && username.trim() !== ''
            : kind === 'audiobookshelf'
              ? /^https?:\/\//.test(url.trim()) && apiKey.trim() !== ''
              : /^https?:\/\//.test(endpoint.trim()) &&
                bucket.trim() !== '' &&
                accessKeyId.trim() !== '';
  // Jellyfin and Audiobookshelf connect in two steps: test the login, then pick libraries. SFTP
  // first shows the server's key.
  const testing =
    (kind === 'jellyfin' && !signedIn) ||
    (kind === 'audiobookshelf' && !absSignedIn) ||
    (kind === 'sftp' && !hostKey);
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
        ...READABLE,
        paddingTop: insets.top + 8,
        paddingHorizontal: 16,
        paddingBottom: 32,
        gap: 16,
      }}
    >
      <ScreenHeader
        inGap
        title={abs ? t('Change key') : locked ? t('Log in again') : t('Add a server')}
        subtitle={
          abs
            ? t('Enter a new API key for this server. The server, its books and your places stay.')
            : locked
              ? t(
                  'Passwords stay on the phone they were entered on and are not in backups. Enter it again; your books and places stay.',
                )
              : t(
                  'Books on your own storage, played straight from it. The address and login stay on this device and are never synced.',
                )
        }
      />

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
        <EmptyState title={t('The add-on for this server is no longer on this device.')} />
      ) : chosenSource ? (
        <>
          <Text className="text-detail text-soft">{chosenSource.manifest.description}</Text>
          {(chosenSource.manifest.settings ?? []).map((field) =>
            field.type === 'signin' ? (
              <AddonSignin
                key={field.key}
                field={field}
                addonUrl={chosenSource.url}
                manifest={chosenSource.manifest}
                sandboxId={checkSandbox}
                values={values}
                {...(addonRoot ? { known: addonSettings(addonRoot) } : {})}
                onDone={(result) => {
                  const next = applySignin(chosenSource.manifest.settings ?? [], values, result, {
                    sealedOnly: locked,
                    // Only add-ons that come with the app fill in addresses it may reach.
                    hosts: chosenSource.bundled,
                  });
                  setValues(next);
                  // Signed in, an add-on that comes with the app can list what there is to pick,
                  // such as Plex's libraries; it filled in the addresses to ask.
                  if (!locked && chosenSource.bundled) void choices.load(next);
                }}
              />
            ) : field.type === 'choice' ? (
              <AddonChoice
                key={field.key}
                field={field}
                options={choices.options[field.key] ?? []}
                value={values[field.key] ?? ''}
                onChange={(v) => setValues((current) => ({ ...current, [field.key]: v }))}
                locked={locked}
                loading={choices.loading}
                error={choices.error}
                {...(choices.asks && field.options === undefined
                  ? { onLoad: () => void choices.load(values) }
                  : {})}
              />
            ) : (
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
            ),
          )}
          {offersPlaces(chosenSource.manifest) && (
            <Text className="text-caption text-muted">
              {t('Places sync both ways with this server, for the profile adding it.')}
            </Text>
          )}
          <Text className="text-caption text-muted">
            {(chosenSource.manifest.sandbox?.hosts ?? []).length > 0
              ? t(
                  'Runs on this device, in a sandbox. It can reach only {hosts} and the addresses in this form, and the login stays on this device.',
                  { hosts: (chosenSource.manifest.sandbox?.hosts ?? []).join(', ') },
                )
              : t(
                  'Runs on this device, in a sandbox. It can reach only the address you enter, and the login stays on this device.',
                )}
          </Text>
          {Platform.OS === 'web' && (
            <Text className="text-detail text-muted">
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
          <AlsoReachable value={alsoUrl} onChange={setAlsoUrl} />
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
              <Text className="text-detail text-soft">{t('Libraries')}</Text>
              {signedIn.libraries.length === 0 ? (
                <EmptyState
                  title={t('This account has no book or music libraries on the server.')}
                />
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
              <Text className="text-caption text-muted">
                {t(
                  'Places sync both ways with this Jellyfin user, for the profile adding the server.',
                )}
              </Text>
            </View>
          )}
          {Platform.OS === 'web' && (
            <Text className="text-detail text-muted">
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
          <AlsoReachable value={alsoUrl} onChange={setAlsoUrl} />
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
              <Text className="text-detail text-soft">{t('Libraries')}</Text>
              {absSignedIn.libraries.length === 0 ? (
                <EmptyState title={t('This account has no book libraries on the server.')} />
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
              <Text className="text-caption text-muted">
                {t(
                  'Places sync both ways with this Audiobookshelf user, for the profile adding the server.',
                )}
              </Text>
            </View>
          )}
          {Platform.OS === 'web' && (
            <Text className="text-detail text-muted">
              {t('In the browser the Audiobookshelf server must allow this site (CORS headers).')}
            </Text>
          )}
        </>
      ) : (kind === 'smb' || kind === 'sftp') && !NETFS ? (
        <Text className="text-muted">
          {t(
            'SMB and SFTP servers are in the Android app only: a browser can’t open these connections.',
          )}
        </Text>
      ) : kind === 'smb' ? (
        <>
          <Field
            label={t('Share address')}
            locked={locked}
            value={url}
            onChange={setUrl}
            placeholder={'smb://nas.local/Audiobooks'}
            hint={t(
              'The computer or NAS, the share and, if you like, a folder in it. Windows shares, Synology, QNAP and Samba work; SMB 1 does not.',
            )}
          />
          <Field
            label={t('Username')}
            value={username}
            onChange={setUsername}
            hint={t('DOMAIN\\name for a Windows domain. Leave it empty for a guest share.')}
          />
          <Field label={t('Password')} value={password} onChange={setPassword} secret />
        </>
      ) : kind === 'sftp' ? (
        <>
          <Field
            label={t('Folder address')}
            locked={locked}
            value={url}
            onChange={setUrl}
            placeholder={'sftp://nas.local/volume1/Audiobooks'}
            hint={t('The server, its port if it is not 22, and the folder’s full path.')}
          />
          <Field label={t('Username')} value={username} onChange={setUsername} />
          <Field
            label={t('Password')}
            value={password}
            onChange={setPassword}
            secret
            hint={t('Or a private key below.')}
          />
          <Field
            label={t('Private key (optional)')}
            value={privateKey}
            onChange={setPrivateKey}
            multiline
            placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----'}
            hint={t('Paste it, or choose the key file. OpenSSH and PEM keys work.')}
          />
          <TextButton
            text={t('Choose a key file')}
            onPress={() => void pickKeyFile()}
            className="self-start"
          />
          {privateKey.trim() !== '' && (
            <Field
              label={t('Key passphrase')}
              value={passphrase}
              onChange={setPassphrase}
              secret
              hint={t('Only if the key has one.')}
            />
          )}
          {hostKey && (
            <View className="gap-1 rounded-lg border border-line p-3">
              <Text className="text-detail text-soft">
                {locked ? t('Trusted host key') : t('The server’s host key')}
              </Text>
              <Text selectable className="font-mono text-caption text-paper">
                {hostKey.algorithm
                  ? `${hostKey.algorithm} ${hostKey.fingerprint}`
                  : hostKey.fingerprint}
              </Text>
              <Text className="text-caption text-muted">
                {locked
                  ? t('Lelap refuses to connect if the server shows a different key.')
                  : t(
                      'Check that it matches the server’s own, for example with ssh-keygen -l on the server. Connect trusts this key, and Lelap then refuses any other.',
                    )}
              </Text>
            </View>
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
          <AlsoReachable value={alsoUrl} onChange={setAlsoUrl} />
          <Field label={t('Username')} value={username} onChange={setUsername} />
          <Field
            label={t('Password')}
            value={password}
            onChange={setPassword}
            secret
            hint={t('An app password is best: it can be revoked without changing your own.')}
          />
          {Platform.OS === 'web' && (
            <Text className="text-detail text-muted">
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

      <Button
        text={testing ? t('Test connection') : t('Connect')}
        disabled={testing ? !ready : !canConnect}
        busy={busy}
        onPress={() =>
          void askLocalNetwork(formIsLocal()).then((allowed) => {
            if (!allowed) return;
            return testing
              ? kind === 'audiobookshelf'
                ? testAudiobookshelf()
                : kind === 'sftp'
                  ? testSftp()
                  : testJellyfin()
              : connect();
          })
        }
      />
    </ScrollView>
  );
}
