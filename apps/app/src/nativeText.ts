import { currentLanguage, subscribeLanguage, t } from './i18n';
import { setNativeText } from './platform/text';

/**
 * Every line Kotlin shows, through the same catalogs as the app. Native code looks them up by the
 * English with the same `{holes}`; `pnpm --filter @lelap/app test` checks this list against the
 * Kotlin source, so a line used there and missing here fails.
 */
const nativeLines = (): Record<string, string> => ({
  // Notification channels, in Android's notification settings.
  'Now playing': t('Now playing'),
  Downloads: t('Downloads'),
  'Wanted books': t('Wanted books'),
  'Finding chapters': t('Finding chapters'),
  // The player's buttons on the notification, lock screen, watches and cars.
  'Back {n} seconds': t('Back {n} seconds'),
  'Forward {n} seconds': t('Forward {n} seconds'),
  'Sleep timer off': t('Sleep timer off'),
  'Sleep timer 15 minutes': t('Sleep timer 15 minutes'),
  'Sleep timer 30 minutes': t('Sleep timer 30 minutes'),
  'Sleep timer end of chapter': t('Sleep timer end of chapter'),
  'Sleep timer on': t('Sleep timer on'),
  // Android Auto's shelves.
  'Continue listening': t('Continue listening'),
  'On this phone': t('On this phone'),
  Podcasts: t('Podcasts'),
  'Up Next': t('Up Next'),
  // Download and chapter-finding notifications.
  Downloading: t('Downloading'),
  Cancel: t('Cancel'),
  'Listening for long silences': t('Listening for long silences'),
  // Downloads in a folder the listener chose, and moving them there.
  'The download folder can’t be reached. Put the SD card back, or choose another folder in Settings.':
    t(
      'The download folder can’t be reached. Put the SD card back, or choose another folder in Settings.',
    ),
  'Moving downloads': t('Moving downloads'),
  'Moving downloads stopped: {reason}': t('Moving downloads stopped: {reason}'),
  'There is not enough space in the new folder.': t('There is not enough space in the new folder.'),
  'Some downloads stay where they are until their folder can be reached again.': t(
    'Some downloads stay where they are until their folder can be reached again.',
  ),
  Stop: t('Stop'),
  // The home screen widget and the Quick Settings tile.
  'Nothing playing': t('Nothing playing'),
  'Open Lelap to pick a book': t('Open Lelap to pick a book'),
  Play: t('Play'),
  Pause: t('Pause'),
  '{what}. Opens the player.': t('{what}. Opens the player.'),
  'Not playing': t('Not playing'),
  Playing: t('Playing'),
  Paused: t('Paused'),
});

let subscribed = false;

/** Hands native code the current language's lines now and after every switch. */
export function syncNativeText(): void {
  setNativeText(currentLanguage(), nativeLines());
  if (subscribed) return;
  subscribed = true;
  subscribeLanguage((language) => setNativeText(language, nativeLines()));
}
