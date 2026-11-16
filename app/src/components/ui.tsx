import { formatTimeCH } from '@fvw/shared';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type TextProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LOGO } from '../lib/brand';
import { useApp } from '../lib/store';
import { radius, space, TOUCH, useColors } from '../lib/theme';

export function Txt({ children, style, muted, bold, size, ...rest }: { children: ReactNode; style?: any; muted?: boolean; bold?: boolean; size?: number } & Omit<TextProps, 'style' | 'children'>) {
  const c = useColors();
  return <Text {...rest} style={[{ color: muted ? c.muted : c.ink, fontSize: size ?? 17, lineHeight: (size ?? 17) * 1.35, fontWeight: bold ? '700' : '400' }, style]}>{children}</Text>;
}
export const H1 = ({ children }: { children: ReactNode }) => <Txt size={26} bold accessibilityRole="header">{children}</Txt>;
export const H2 = ({ children }: { children: ReactNode }) => <Txt size={20} bold accessibilityRole="header" style={{ marginTop: space.m }}>{children}</Txt>;

/** Vereinslogo – proportional, unverändert. Platzhalter, solange logo-transparent.png fehlt. */
export function ClubLogo({ size = 40 }: { size?: number }) {
  const c = useColors();
  if (LOGO) return <Image source={LOGO} style={{ width: size, height: size }} resizeMode="contain" accessibilityLabel="Logo Fischereiverein Werdenberg" />;
  return (
    <View accessibilityLabel="Logo-Platzhalter Fischereiverein Werdenberg" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.water, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c.waterInk, fontWeight: '800', fontSize: size * 0.32 }}>FVW</Text>
    </View>
  );
}

export function SyncPill() {
  const { online, pending, syncing, lastSync, lastSyncResult, authProblem } = useApp();
  const c = useColors();
  let label: string, bg: string, fg: string;
  if (authProblem) { label = 'Anmeldung nötig'; bg = c.stopSoft; fg = c.stop; }
  else if (!online) { label = pending ? `Offline · ${pending} ausstehend` : 'Offline'; bg = c.warnSoft; fg = c.warn; }
  else if (syncing) { label = 'Synchronisiere …'; bg = c.waterSoft; fg = c.water; }
  else if (pending) { label = `${pending} ausstehend`; bg = c.warnSoft; fg = c.warn; }
  else if (lastSyncResult && !lastSyncResult.ok) { label = 'Sync-Fehler'; bg = c.stopSoft; fg = c.stop; }
  else { label = lastSync ? `Synchronisiert ${formatTimeCH(lastSync)}` : 'Online'; bg = c.mossSoft; fg = c.moss; }
  return (
    <Pressable onPress={() => router.push('/status')} accessibilityRole="button" accessibilityLabel={`Synchronisationsstatus: ${label}. Details anzeigen`}
      style={{ backgroundColor: bg, borderColor: fg, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, justifyContent: 'center' }}>
      <Text style={{ color: fg, fontWeight: '700', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Screen({ title, children, scroll = true, right, testID, back }: { title: string; children: ReactNode; scroll?: boolean; right?: ReactNode; testID?: string; back?: boolean }) {
  const c = useColors();
  const body = <View style={{ padding: space.l, gap: space.m, paddingBottom: 48 }}>{children}</View>;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }} testID={testID}>
      <View style={[styles.header, { borderBottomColor: c.line, backgroundColor: c.surface }]}>
        {back ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Zurück" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }} testID="nav-back">
            <Text style={{ fontSize: 28, color: c.water, fontWeight: '800' }}>‹</Text>
          </Pressable>
        ) : <ClubLogo size={36} />}
        <Text style={{ flex: 1, color: c.ink, fontSize: 21, fontWeight: '800' }} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {right}
        <SyncPill />
      </View>
      <AuthBanner />
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>{body}</ScrollView> : <View style={{ flex: 1 }}>{children}</View>}
    </SafeAreaView>
  );
}

function AuthBanner() {
  const { authProblem, pending } = useApp();
  if (!authProblem) return null;
  return <Banner kind="error" title="Bitte erneut anmelden" action={{ label: 'Anmelden', onPress: () => router.push('/login') }}>{`${authProblem}${pending ? ` – ${pending} Einträge bleiben auf dem Gerät gespeichert und werden nach der Anmeldung übertragen.` : ''}`}</Banner>;
}

type BtnKind = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
export function Button({ label, onPress, kind = 'secondary', disabled, busy, big, icon, accessibilityHint, testID, style }: { label: string; onPress: () => void; kind?: BtnKind; disabled?: boolean; busy?: boolean; big?: boolean; icon?: string; accessibilityHint?: string; testID?: string; style?: ViewStyle }) {
  const c = useColors();
  const map: Record<BtnKind, [string, string, string]> = {
    primary: [c.water, c.waterInk, c.water], secondary: [c.surface, c.ink, c.line], danger: [c.stop, c.stopInk, c.stop], success: [c.moss, c.mossInk, c.moss], ghost: ['transparent', c.water, 'transparent'],
  };
  const [bg, fg, border] = map[kind];
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint} accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [{ minHeight: big ? 72 : TOUCH, borderRadius: radius.m, backgroundColor: bg, borderColor: border, borderWidth: 2, paddingHorizontal: space.l, paddingVertical: space.s, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '800', fontSize: big ? 22 : 18, textAlign: 'center' }}>{icon ? `${icon}  ` : ''}{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style, testID }: { children: ReactNode; style?: ViewStyle; testID?: string }) {
  const c = useColors();
  return <View testID={testID} style={[{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: radius.l, padding: space.l, gap: space.s }, style]}>{children}</View>;
}

export function Banner({ kind, title, children, action }: { kind: 'info' | 'warn' | 'error' | 'success'; title?: string; children?: ReactNode; action?: { label: string; onPress: () => void } }) {
  const c = useColors();
  const [bg, fg] = { info: [c.waterSoft, c.water], warn: [c.warnSoft, c.warn], error: [c.stopSoft, c.stop], success: [c.mossSoft, c.moss] }[kind];
  return (
    <View accessibilityRole={kind === 'error' ? 'alert' : undefined} style={{ backgroundColor: bg, borderLeftColor: fg, borderLeftWidth: 5, borderRadius: radius.s, padding: space.m, gap: 6, marginHorizontal: 0 }}>
      {title ? <Text style={{ color: fg, fontWeight: '800', fontSize: 17 }}>{title}</Text> : null}
      {typeof children === 'string' ? <Text style={{ color: c.ink, fontSize: 16, lineHeight: 22 }}>{children}</Text> : children}
      {action ? <Pressable accessibilityRole="button" onPress={action.onPress} style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}><Text style={{ color: fg, fontWeight: '800', fontSize: 16, textDecorationLine: 'underline' }}>{action.label}</Text></Pressable> : null}
    </View>
  );
}

export function Pill({ label, kind = 'info' }: { label: string; kind?: 'info' | 'warn' | 'error' | 'success' | 'neutral' }) {
  const c = useColors();
  const [bg, fg] = { info: [c.waterSoft, c.water], warn: [c.warnSoft, c.warn], error: [c.stopSoft, c.stop], success: [c.mossSoft, c.moss], neutral: [c.bg, c.muted] }[kind];
  return <View style={{ backgroundColor: bg, borderColor: fg, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2, alignSelf: 'flex-start' }}><Text style={{ color: fg, fontSize: 13, fontWeight: '700' }}>{label}</Text></View>;
}

export function Field({ label, hint, error, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.ink, fontWeight: '700', fontSize: 17 }}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={c.muted} {...props}
        style={[{ minHeight: TOUCH, borderRadius: radius.m, borderWidth: 2, borderColor: error ? c.stop : c.line, backgroundColor: c.bg, color: c.ink, fontSize: 20, paddingHorizontal: space.m }, props.multiline ? { minHeight: 110, textAlignVertical: 'top', paddingTop: space.s, fontSize: 18 } : null, props.style]} />
      {hint ? <Text style={{ color: c.muted, fontSize: 14 }}>{hint}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.stop, fontSize: 15, fontWeight: '700' }}>{error}</Text> : null}
    </View>
  );
}

/** Auswahl mit grossen Knöpfen (z. B. Fischart, Verbleib). */
export function ChoiceGrid<T extends string>({ options, value, onChange, columns = 3, label, testIDPrefix }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; columns?: number; label: string; testIDPrefix?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.ink, fontWeight: '700', fontSize: 17 }}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const sel = o.value === value;
          return (
            <Pressable key={o.value} testID={testIDPrefix ? `${testIDPrefix}-${o.value}` : undefined} accessibilityRole="radio" accessibilityState={{ selected: sel }} accessibilityLabel={o.label} onPress={() => onChange(o.value)}
              style={{ flexBasis: `${100 / columns - 3}%`, flexGrow: 1, minHeight: 60, borderRadius: radius.m, borderWidth: 2, borderColor: sel ? c.water : c.line, backgroundColor: sel ? c.water : c.bg, alignItems: 'center', justifyContent: 'center', padding: 6 }}>
              <Text style={{ color: sel ? c.waterInk : c.ink, fontWeight: '800', fontSize: 17, textAlign: 'center' }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', gap: space.s, alignItems: 'center', flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Empty({ text }: { text: string }) {
  return <Txt muted style={{ paddingVertical: space.m }}>{text}</Txt>;
}

export function Loading({ text = 'Lade …' }: { text?: string }) {
  const c = useColors();
  return <View style={{ padding: space.xl, alignItems: 'center', gap: 8 }}><ActivityIndicator color={c.water} size="large" /><Txt muted>{text}</Txt></View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.l, paddingVertical: space.s, borderBottomWidth: 1, minHeight: 60 },
});
