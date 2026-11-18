// Android: the app is upright on phones (app.json); car mode lets the phone turn (M107).
import { lockAsync, OrientationLock, unlockAsync } from 'expo-screen-orientation';
import { useEffect } from 'react';

/** While the calling screen is open, it turns with the phone, as the rotation setting allows. */
export function useSideways(): void {
  useEffect(() => {
    void unlockAsync().catch(() => {});
    return () => {
      void lockAsync(OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);
}
