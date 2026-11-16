import { Redirect, useSegments } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { Banner, Button, Loading } from '../components/ui';
import { AppProvider, useApp } from '../lib/store';
import { useColors } from '../lib/theme';

function Gate() {
  const { ready, session, startError, retryStart } = useApp();
  const segments = useSegments();
  const c = useColors();
  if (startError) return <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16, backgroundColor: c.bg }}><Banner kind="error" title="App konnte nicht starten">{`${startError}. Ihre gespeicherten Daten bleiben erhalten.`}</Banner><Button label="Erneut versuchen" kind="primary" onPress={retryStart} /></View>;
  if (!ready) return <Loading text="Fangbuch wird geöffnet …" />;
  const onLogin = segments[0] === 'login';
  if (!session && !onLogin) return <Redirect href="/login" />;
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" />
        {['patent', 'news', 'termine', 'meldung', 'kontrolle', 'admin', 'profil', 'status'].map((n) => <Stack.Screen key={n} name={n} />)}
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Gate />
      </AppProvider>
    </SafeAreaProvider>
  );
}
