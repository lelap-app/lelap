import { useLocalSearchParams, useRouter } from 'expo-router';

import { PodcastPage } from '../src/components/PodcastPage';

export default function PodcastScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; item?: string }>();
  return <PodcastPage id={params.id} item={params.item} onBack={() => router.back()} />;
}
