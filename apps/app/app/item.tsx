import { useLocalSearchParams, useRouter } from 'expo-router';

import { ItemPage } from '../src/components/ItemPage';

export default function ItemScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; id?: string }>();
  return <ItemPage type={params.type} id={params.id ?? ''} onBack={() => router.back()} />;
}
