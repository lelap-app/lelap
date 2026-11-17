// Android implementation. The web app updates itself through its host.
import { distribution } from '../config';

export * from '@lelap/updater';

/** Off in the F-Droid build, where F-Droid installs updates. */
export const SELF_UPDATES = distribution !== 'fdroid';
