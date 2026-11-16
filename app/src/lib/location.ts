import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { kvGet, kvSet } from './db';

/**
 * Standort (PA §7/§14): standardmässig AUS. Nur nach Zustimmung in der App UND Freigabe des Betriebssystems.
 * Es wird kein Standortverlauf gespeichert und nichts an den Verein übermittelt.
 */
export interface Pos { lat: number; lon: number; accuracyM: number | null; at: number }

export const LOCATION_PURPOSE = 'Die App nutzt Ihren Standort nur, solange Sie es erlauben: um Ihre Position auf der Gewässerkarte zu zeigen, beim Tourstart ein Gewässer vorzuschlagen und vor gesperrten Bereichen zu warnen. Der Standort wird weder gespeichert noch an den Verein übermittelt. GPS ist nur eine ungefähre Orientierung.';

export async function getConsent(): Promise<boolean> {
  return (await kvGet<boolean>('location_consent')) === true;
}

export async function setConsent(v: boolean) {
  await kvSet('location_consent', v);
}

export async function requestOsPermission(): Promise<boolean> {
  const r = await Location.requestForegroundPermissionsAsync();
  return r.status === 'granted';
}

export function useLocation(enabled: boolean): { pos: Pos | null; error: string | null } {
  const [pos, setPos] = useState<Pos | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) { setPos(null); return; }
    let sub: Location.LocationSubscription | null = null;
    let alive = true;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') { setError('Standortfreigabe des Betriebssystems fehlt.'); return; }
        sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 5000 }, (l) => {
          if (alive) { setPos({ lat: l.coords.latitude, lon: l.coords.longitude, accuracyM: l.coords.accuracy ?? null, at: l.timestamp }); setError(null); }
        }, (e) => setError(String(e)));
      } catch (e: any) {
        setError(e?.message ?? 'Standort nicht verfügbar');
      }
    })();
    return () => { alive = false; sub?.remove(); };
  }, [enabled]);
  return { pos, error };
}

export async function currentPosition(): Promise<Pos | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const l = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: l.coords.latitude, lon: l.coords.longitude, accuracyM: l.coords.accuracy ?? null, at: l.timestamp };
  } catch {
    return null;
  }
}
