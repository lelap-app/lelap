import { Redirect } from 'expo-router';

import { SpikeScreen } from '../../src/dev/SpikeScreen';

// Kept until the remaining M1 call checks pass (modules/audio/README.md). Debug builds only: in a
// release build a link to /dev/spike lands on the start screen.
export default function Spike() {
  return __DEV__ ? <SpikeScreen /> : <Redirect href="/" />;
}
