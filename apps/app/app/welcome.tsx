import { isKidsProfile, listRoots, setFirstStartDone } from '@lelap/core';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { type ComponentRef, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  findNodeHandle,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAddons } from '../src/addons';
import { showAlert } from '../src/dialog';
import { t } from '../src/i18n';
import { Icon, type IconName } from '../src/components/Icon';
import { Lori } from '../src/components/Lori';
import { OwnAddonOffer, useOwnAddonOffers } from '../src/components/OwnAddons';
import { TextButton } from '../src/components/TextButton';
import { defaultAddons } from '../src/config';
import { db } from '../src/db';
import { formatNames } from '../src/format';
import { LOCAL_FOLDERS } from '../src/platform/library';
import { profileId } from '../src/profile';
import { useLibrary } from '../src/player';
import { chooseFolder, scanLibrary } from '../src/scan';
import { membership } from '../src/sync';
import { useColors } from '../src/theme';

type Step = 'welcome' | 'source' | 'addons';
/** Where the listener lands when the first start ends: their own books, or the free catalogs. */
type Landing = '/library' | '/';

/**
 * A new step starts at the top, and TalkBack (or the browser's focus) moves to its title, so the
 * step is read first.
 */
function useFocusOnStep(step: Step) {
  const title = useRef<ComponentRef<typeof Text>>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const first = useRef(true);
  useEffect(() => {
    // The first step is read from the top anyway.
    if (first.current) {
      first.current = false;
      return;
    }
    scroll.current?.scrollTo({ y: 0, animated: false });
    // TalkBack ignores focus on a view that is not in its tree yet.
    const timer = setTimeout(() => {
      const node = title.current;
      if (!node) return;
      if (Platform.OS === 'web') {
        const element = node as unknown as HTMLElement;
        element.setAttribute('tabindex', '-1');
        element.focus();
        return;
      }
      const handle = findNodeHandle(node);
      if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
    }, 100);
    return () => clearTimeout(timer);
  }, [step]);
  return { title, scroll };
}

function Choice({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: IconName;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-12 flex-row items-center gap-4 rounded-xl border border-line p-4 active:bg-raised"
    >
      <Icon name={icon} color={colors.amber} />
      <View className="flex-1 gap-1">
        <Text className="text-base font-semibold text-paper">{title}</Text>
        <Text className="text-sm text-soft">{detail}</Text>
      </View>
      <Icon name="forward" size={20} color={colors.muted} />
    </Pressable>
  );
}

function PrimaryButton({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-12 items-center justify-center rounded-full bg-amber px-6 py-3 active:opacity-80"
    >
      <Text className="font-semibold text-ink">{text}</Text>
    </Pressable>
  );
}

/**
 * The first start (M82): a welcome, where books come from, then Lelap's own optional add-ons.
 * Shown once, on a device with nothing in it yet (`needsFirstStart`); every step can be skipped.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const addons = useAddons();
  const offers = useOwnAddonOffers(addons, { pasteBelow: false });
  const [step, setStep] = useState<Step>('welcome');
  const [landing, setLanding] = useState<Landing>('/');
  // Set when “A server” or “Another device” opened their screen, to move on once one is added.
  // A ref, so setting it doesn't re-run the focus check before the other screen opens.
  const waitingFor = useRef<'server' | 'sync' | null>(null);
  const { title, scroll } = useFocusOnStep(step);
  const { refresh, version } = useLibrary();
  // Named from what this build installed: a fork's defaults may leave LibriVox out.
  const free = addons.filter((a) => a.builtin).map((a) => a.manifest.name);
  let freeDetail = t('Free catalogs appear on Home once Lelap’s default add-ons are installed.');
  if (free.length === 1) {
    freeDetail = t('{name} is already installed. Its free books are on Home.', {
      name: formatNames(free),
    });
  } else if (free.length > 1) {
    freeDetail = t('{names} are already installed. Their free books are on Home.', {
      names: formatNames(free),
    });
  }

  // Back goes to the step before; on the first step it leaves as usual.
  useEffect(() => {
    if (step === 'welcome') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setStep(step === 'addons' ? 'source' : 'welcome');
      return true;
    });
    return () => sub.remove();
  }, [step]);

  // Back from the server or sync screen: once one was added, on to the add-ons.
  useFocusEffect(
    useCallback(() => {
      const waited = waitingFor.current;
      waitingFor.current = null;
      if (step !== 'source' || waited === null) return;
      const added = waited === 'server' ? listRoots(db).length > 0 : membership() !== null;
      if (!added) return;
      setLanding('/library');
      setStep('addons');
    }, [step]),
  );

  // The profile picker at launch may switch to a kids profile, which never sees this.
  useEffect(() => {
    if (isKidsProfile(db, profileId)) router.replace('/');
    // `version` is the signal to re-read the database.
  }, [version, router]);

  const finish = (to: Landing) => {
    setFirstStartDone(db, profileId, Date.now());
    router.replace(to as Href);
  };

  const pickFolder = async () => {
    try {
      if (!(await chooseFolder())) return;
    } catch (error) {
      showAlert(
        t('Cannot open the folder'),
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    // Scanning starts now, so the books are there even if the app closes during the add-ons.
    void scanLibrary().finally(refresh);
    setLanding('/library');
    setStep('addons');
  };

  let body: ReactNode;
  if (step === 'welcome') {
    body = (
      <>
        <View className="items-center pb-2">
          <Lori size={150} />
        </View>
        <Text
          ref={title}
          accessibilityRole="header"
          className="text-center text-3xl font-semibold text-paper"
        >
          {t('Welcome to Lelap')}
        </Text>
        <Text className="text-center text-base text-soft">
          {t(
            'Lelap plays audiobooks and podcasts. It remembers your place in every book, and it needs no account.',
          )}
        </Text>
        <Text className="text-center text-base text-soft">
          {t(
            'Books come from your own files, a server you run, or free catalogs. Add-ons bring more.',
          )}
        </Text>
        <View className="gap-2 pt-4">
          <PrimaryButton text={t('Get started')} onPress={() => setStep('source')} />
          <TextButton text={t('Skip')} tone="muted" onPress={() => finish('/')} />
        </View>
      </>
    );
  } else if (step === 'source') {
    body = (
      <>
        <Text ref={title} accessibilityRole="header" className="text-3xl font-semibold text-paper">
          {t('Where are your books?')}
        </Text>
        <Text className="text-base text-soft">
          {t('Choose one to start. You can add the others later in Settings.')}
        </Text>
        {LOCAL_FOLDERS ? (
          <Choice
            icon="library"
            title={t('A folder on this phone')}
            detail={t('Lelap plays the audiobooks where they are and keeps them up to date.')}
            onPress={() => void pickFolder()}
          />
        ) : (
          <Choice
            icon="cast"
            title={t('Another device with Lelap')}
            detail={t(
              'A browser can’t open folders. Join your phone with a pairing code to bring its podcasts and streamed books here.',
            )}
            onPress={() => {
              waitingFor.current = 'sync';
              router.push('/sync');
            }}
          />
        )}
        <Choice
          icon="cloud"
          title={t('A server')}
          detail={t(
            'Audiobookshelf, Jellyfin, WebDAV, an S3-compatible bucket and more. Lelap checks it before adding it.',
          )}
          onPress={() => {
            waitingFor.current = 'server';
            router.push('/server');
          }}
        />
        {/* A build without default add-ons has no free books to offer. */}
        {defaultAddons.length > 0 && (
          <Choice
            icon="discover"
            title={t('Free books to play now')}
            detail={freeDetail}
            onPress={() => {
              setLanding('/');
              setStep('addons');
            }}
          />
        )}
        <TextButton text={t('Skip')} tone="muted" onPress={() => finish('/')} />
      </>
    );
  } else {
    body = (
      <>
        <Text ref={title} accessibilityRole="header" className="text-3xl font-semibold text-paper">
          {t('Optional add-ons')}
        </Text>
        <Text className="text-base text-soft">
          {t(
            'Lelap’s own add-ons for services you may already use. Each needs your account there; leave them for later if you like.',
          )}
        </Text>
        {offers.length === 0 ? (
          <Text className="text-sm text-muted">{t('All of them are set up.')}</Text>
        ) : (
          <View>
            {offers.map((offer) => (
              <OwnAddonOffer key={offer.key} offer={offer} />
            ))}
          </View>
        )}
        <Text className="text-sm text-muted">
          {t('Add-ons from others can be added in Settings → Add-ons.')}
        </Text>
        <View className="pt-2">
          <PrimaryButton text={t('Done')} onPress={() => finish(landing)} />
        </View>
      </>
    );
  }

  return (
    <ScrollView
      ref={scroll}
      className="flex-1 bg-night"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: step === 'welcome' ? 'center' : 'flex-start',
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
        gap: 16,
        width: '100%',
        maxWidth: 560,
        alignSelf: 'center',
      }}
    >
      {body}
    </ScrollView>
  );
}
