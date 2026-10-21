import { BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import { Figtree_500Medium, Figtree_700Bold } from '@expo-google-fonts/figtree';
import { CouchCoachApp } from '@multi-tv/shared-ui';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { LogBox } from 'react-native';

if (__DEV__) {
  // Library deprecation noise from react-tv-space-navigation; harmless.
  LogBox.ignoreLogs([/findNodeHandle is deprecated/, /findHostInstance_DEPRECATED is deprecated/]);
}

// Keep the splash up until the Lamplight fonts are ready. If they fail, the system fonts keep the sizes.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  const [loaded, error] = useFonts({
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    Figtree_500Medium,
    Figtree_700Bold,
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded, error]);

  return <CouchCoachApp fontsLoaded={loaded || !!error} />;
}
