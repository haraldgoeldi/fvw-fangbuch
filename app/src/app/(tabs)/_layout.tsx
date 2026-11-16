import { Tabs } from 'expo-router/js-tabs';
import { Text } from 'react-native';
import { useColors } from '../../lib/theme';

import type { ColorValue } from 'react-native';
const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ fontSize: 22, color }} accessibilityElementsHidden>{glyph}</Text>;

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: c.water,
      tabBarInactiveTintColor: c.muted,
      tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line, minHeight: 64, paddingTop: 4 },
      tabBarLabelStyle: { fontSize: 14, fontWeight: '700' },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Start', tabBarIcon: icon('⌂') }} />
      <Tabs.Screen name="tour" options={{ title: 'Fischen', tabBarIcon: icon('🎣') }} />
      <Tabs.Screen name="karte" options={{ title: 'Karte', tabBarIcon: icon('🗺') }} />
      <Tabs.Screen name="fangbuch" options={{ title: 'Fangbuch', tabBarIcon: icon('📖') }} />
      <Tabs.Screen name="mehr" options={{ title: 'Mehr', tabBarIcon: icon('☰') }} />
    </Tabs>
  );
}
