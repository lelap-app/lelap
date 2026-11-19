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
  'Next in list': t('Next in list'),
  // Android Auto's shelves.
  'Continue listening': t('Continue listening'),
  'On this phone': t('On this phone'),
  Podcasts: t('Podcasts'),
  'Up Next': t('Up Next'),
  // Download and chapter-finding notifications.
  Downloading: t('Downloading'),
  Cancel: t('Cancel'),
  'Listening for long silences': t('Listening for long silences'),
  'Finding chapters in {title}': t('Finding chapters in {title}'),
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
  'The file doesn’t match the checksum in the feed, so it was not kept. It may have changed on the way.':
    t(
      'The file doesn’t match the checksum in the feed, so it was not kept. It may have changed on the way.',
    ),
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
  // Cast device authentication (M78).
  '{name} didn’t prove it’s a genuine Google Cast device, so Lelap didn’t connect.': t(
    '{name} didn’t prove it’s a genuine Google Cast device, so Lelap didn’t connect.',
  ),
  '{name} cannot play media': t('{name} cannot play media'),
  'Connect the phone to the same Wi-Fi as the speaker': t(
    'Connect the phone to the same Wi-Fi as the speaker',
  ),
  'That speaker is no longer on the network': t('That speaker is no longer on the network'),
  'Not casting': t('Not casting'),
  'Casting failed': t('Casting failed'),
  'Casting stopped': t('Casting stopped'),
  // Why a download, a move, an update or casting failed, rather than Android's own words (M99).
  'The server’s address can’t be found. Check the connection.': t(
    'The server’s address can’t be found. Check the connection.',
  ),
  'The server did not answer in time.': t('The server did not answer in time.'),
  'The secure connection to the server failed.': t('The secure connection to the server failed.'),
  'The phone’s storage is full.': t('The phone’s storage is full.'),
  'Lelap may no longer use the folder. Choose it again in Settings.': t(
    'Lelap may no longer use the folder. Choose it again in Settings.',
  ),
  'Could not create {name} in the download folder.': t(
    'Could not create {name} in the download folder.',
  ),
  '{name} is not a folder.': t('{name} is not a folder.'),
  'Could not write {name}.': t('Could not write {name}.'),
  '{name} is missing.': t('{name} is missing.'),
  'Could not read {name}.': t('Could not read {name}.'),
  'Could not save {name}.': t('Could not save {name}.'),
  'The copy of {name} came out the wrong size.': t('The copy of {name} came out the wrong size.'),
  'Could not make the book’s folder in the download folder.': t(
    'Could not make the book’s folder in the download folder.',
  ),
  'Moving downloads stopped.': t('Moving downloads stopped.'),
  'The download is larger than the release.': t('The download is larger than the release.'),
  'The update was cancelled.': t('The update was cancelled.'),
  'Android blocked the update.': t('Android blocked the update.'),
  'The update is signed differently from the installed app, so Android refused it.': t(
    'The update is signed differently from the installed app, so Android refused it.',
  ),
  'The update does not fit this phone.': t('The update does not fit this phone.'),
  'The update file is damaged. Try again.': t('The update file is damaged. Try again.'),
  'The speaker refused the command (UPnP error {code}).': t(
    'The speaker refused the command (UPnP error {code}).',
  ),
  'The speaker answered HTTP {status}.': t('The speaker answered HTTP {status}.'),
  // The line under the player when playback fails (M99).
  'The server would not send the file.': t('The server would not send the file.'),
  'The file is gone. It may have been moved or deleted.': t(
    'The file is gone. It may have been moved or deleted.',
  ),
  'Lelap may no longer read this file. Choose its folder again in Settings.': t(
    'Lelap may no longer read this file. Choose its folder again in Settings.',
  ),
  'This file can’t be read. It may be damaged, or in a format Lelap does not play.': t(
    'This file can’t be read. It may be damaged, or in a format Lelap does not play.',
  ),
  'This phone can’t play this kind of audio.': t('This phone can’t play this kind of audio.'),
  'The phone’s sound output failed. Press play to try again.': t(
    'The phone’s sound output failed. Press play to try again.',
  ),
  'This file is copy-protected, so Lelap can’t play it.': t(
    'This file is copy-protected, so Lelap can’t play it.',
  ),
  'The file could not be played. Press play to try again.': t(
    'The file could not be played. Press play to try again.',
  ),
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
