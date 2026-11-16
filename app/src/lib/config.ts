import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Backend-URL: EXPO_PUBLIC_API_URL (Build-Zeit) > app.json extra.apiUrl > gleiche Herkunft (Web).
 * Die App enthält KEINE geheimen Schlüssel – nur diese öffentliche Adresse.
 */
function resolveApiUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.port !== '8081') return window.location.origin;
  const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };
  return (extra.apiUrl ?? 'http://localhost:8787').replace(/\/$/, '');
}

export const API_URL = resolveApiUrl();
export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

/** Mitgelieferter Kartenstand (vor dem ersten Herunterladen vom Backend). */
export const BUNDLED_MAP_LABEL = 'Mitgelieferter Kartenstand (Live-Abruf 15.11.2026, noch nicht als geprüfte Basis bestätigt)';
