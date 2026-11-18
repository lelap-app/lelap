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
  // Downloads from SMB and SFTP servers (M62) that will not pass by trying again.
  'The server refused the login. Log in again in Settings.': t(
    'The server refused the login. Log in again in Settings.',
  ),
  'The server’s host key changed, so Lelap did not connect. If you changed it yourself, remove the server in Settings and add it again.':
    t(
      'The server’s host key changed, so Lelap did not connect. If you changed it yourself, remove the server in Settings and add it again.',
    ),
  'The server’s host key is not trusted yet. Add the server again.': t(
    'The server’s host key is not trusted yet. Add the server again.',
  ),
  'The private key can’t be read. Check its passphrase.': t(
    'The private key can’t be read. Check its passphrase.',
  ),
  'The file is no longer on the server.': t('The file is no longer on the server.'),
  'The server does not let this login read the file.': t(
    'The server does not let this login read the file.',
  ),
  'The server address is not valid.': t('The server address is not valid.'),
  'The server did not answer within 30 s.': t('The server did not answer within 30 s.'),
  'No answer from the server.': t('No answer from the server.'),
  // Android 17: a download from a server at home without local network access.
  'Lelap can’t reach this server on your home network: “nearby devices” is off. Download again to allow it.':
    t(
      'Lelap can’t reach this server on your home network: “nearby devices” is off. Download again to allow it.',
    ),
  // Downloads over the web, and app updates (M72).
  'The download failed.': t('The download failed.'),
  'The download kept failing: {reason}': t('The download kept failing: {reason}'),
  'The server sent a message instead of the file.': t(
    'The server sent a message instead of the file.',
  ),
  'The server does not continue downloads (HTTP {status}).': t(
    'The server does not continue downloads (HTTP {status}).',
  ),
  'The server answered HTTP {status}.': t('The server answered HTTP {status}.'),
  'Only web addresses can be downloaded.': t('Only web addresses can be downloaded.'),
  'The server answered HTTP {status} without an address to go to.': t(
    'The server answered HTTP {status} without an address to go to.',
  ),
  'The server sent the download through too many addresses.': t(
    'The server sent the download through too many addresses.',
  ),
  'The connection closed early.': t('The connection closed early.'),
  'The download does not match the release. Try again.': t(
    'The download does not match the release. Try again.',
  ),
  'Updates come only over https.': t('Updates come only over https.'),
  'The update was not installed.': t('The update was not installed.'),
  // Casting (M72).
  'Lost the connection to {name}': t('Lost the connection to {name}'),
  '{name} did not start its media player': t('{name} did not start its media player'),
  '{name} did not answer': t('{name} did not answer'),
  '{name} could not play this file': t('{name} could not play this file'),
  '{name} cannot play media': t('{name} cannot play media'),
  'Connect the phone to the same Wi-Fi as the speaker': t(
    'Connect the phone to the same Wi-Fi as the speaker',
  ),
  'That speaker is no longer on the network': t('That speaker is no longer on the network'),
  'Not casting': t('Not casting'),
  'Casting failed': t('Casting failed'),
  'Casting stopped': t('Casting stopped'),
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
