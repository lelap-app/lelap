import { useLocalSearchParams, useRouter } from 'expo-router';

import { FolderPodcastPage } from '../src/components/FolderPodcastPage';

export default function FolderScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  return <FolderPodcastPage id={params.id ?? ''} onBack={() => router.back()} />;
}
