import { useRouter } from 'expo-router';

import { ProfilePicker } from '../src/components/ProfilePicker';

/** The picker opened from Home's avatar, to switch listener. */
export default function WhoScreen() {
  const router = useRouter();
  return <ProfilePicker onPicked={() => router.back()} />;
}
