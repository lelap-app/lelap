import { StatusBar } from 'expo-status-bar';

import { PlayerScreen } from './src/PlayerScreen';

export function App() {
  return (
    <>
      <PlayerScreen />
      <StatusBar style="light" />
    </>
  );
}
