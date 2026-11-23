import { useSyncExternalStore } from 'react';
import { useColorScheme } from 'react-native';
import { secureGet, secureSet } from './secure';

/**
 * Farben: ruhige Wasser-/Naturtöne mit hohem Kontrast (Sonne, nasse Hände).
 * Abgeleitet vom bestehenden Web-Prototyp; bis das Vereinslogo vorliegt, ohne Logofarben.
 */
const light = {
  bg: '#EDF1EC', surface: '#FFFFFF', ink: '#10212A', muted: '#4D6168', line: '#C9D3CC',
  water: '#1B566A', waterInk: '#FFFFFF', waterSoft: '#DCEAEE',
  moss: '#2A6440', mossInk: '#FFFFFF', mossSoft: '#E0EEE4',
  stop: '#A8302A', stopInk: '#FFFFFF', stopSoft: '#F8E1DF',
  warn: '#7A4F00', warnSoft: '#FFF0CC', focus: '#E0A100',
  mapLine: '#1F7A9C', mapClosed: '#C0302A', mapUnclear: '#B06A00', mapBoundary: '#222222',
};
const dark: typeof light = {
  bg: '#0E181D', surface: '#162329', ink: '#E9F1ED', muted: '#9DB0B5', line: '#2C3E44',
  water: '#7CC4DA', waterInk: '#08171C', waterSoft: '#1C323B',
  moss: '#7FCB95', mossInk: '#0A1A10', mossSoft: '#1A2E22',
  stop: '#F07A70', stopInk: '#240806', stopSoft: '#3A1A18',
  warn: '#F2C14E', warnSoft: '#3A2E10', focus: '#F2BE3A',
  mapLine: '#1F7A9C', mapClosed: '#C0302A', mapUnclear: '#B06A00', mapBoundary: '#222222',
};
export type Colors = typeof light;

/**
 * Darstellung: Standard ist hell (Wunsch Verein, 23.11.2026), unabhängig vom Handy-Design.
 * Dunkel oder «wie Gerät» kann unter Mehr → Profil & Einstellungen gewählt werden.
 */
export type ThemeMode = 'light' | 'dark' | 'system';
export const THEME_MODE_LABELS: Record<ThemeMode, string> = { light: 'Hell', dark: 'Dunkel', system: 'Wie Gerät' };
const THEME_KEY = 'theme_mode';
let mode: ThemeMode = 'light';
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

secureGet(THEME_KEY).then((v) => {
  if (v === 'light' || v === 'dark' || v === 'system') { mode = v; listeners.forEach((l) => l()); }
}).catch(() => { /* Standard hell behalten */ });

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, () => mode, () => mode);
}
export async function setThemeMode(next: ThemeMode): Promise<void> {
  mode = next;
  listeners.forEach((l) => l());
  try { await secureSet(THEME_KEY, next); } catch { /* nur für diese Sitzung */ }
}

export function useIsDark(): boolean {
  const m = useThemeMode();
  const system = useColorScheme();
  return m === 'dark' || (m === 'system' && system === 'dark');
}

export function useColors(): Colors {
  return useIsDark() ? dark : light;
}

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
/** Mindestgrösse für Touchflächen (WCAG/Apple 44 pt; am Wasser grosszügiger). */
export const TOUCH = 56;
export const radius = { s: 8, m: 12, l: 16 };
