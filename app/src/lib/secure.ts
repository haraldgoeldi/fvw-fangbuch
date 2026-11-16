import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Sitzungstoken und Datenbankschlüssel im sicheren Speicher (iOS Keychain / Android Keystore).
 * Web (nur Test/Vorschau): sessionStorage bzw. localStorage – dort KEIN sicherer Speicher.
 */
export async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return window.localStorage.getItem(`fvw_${key}`); } catch { return null; }
  }
  return SecureStore.getItemAsync(key);
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { window.localStorage.setItem(`fvw_${key}`, value); } catch { /* ignorieren */ }
    return;
  }
  await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}

export async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { window.localStorage.removeItem(`fvw_${key}`); } catch { /* ignorieren */ }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const secureStorageAvailable = Platform.OS !== 'web';
