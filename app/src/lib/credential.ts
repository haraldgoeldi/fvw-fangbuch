import { ed25519 } from '@noble/curves/ed25519.js';
import { zurichDate } from '@fvw/shared';
import { base64UrlToBytes, utf8Decode, utf8Encode } from './base64';

/**
 * Offline-Prüfung eines Ausweises (QR) durch den Aufseher:
 * Signatur (Ed25519) mit dem öffentlichen Schlüssel des Vereins, Gültigkeit und Sperrliste.
 */
export interface CredentialPayload { v: 1; c: string; n: string; t: string; g: string | null; f: string; u: string; d?: 1; i: string }
export type CheckResult =
  | { ok: true; status: 'gueltig' | 'abgelaufen' | 'noch_nicht_gueltig' | 'gesperrt'; payload: CredentialPayload }
  | { ok: false; status: 'ungueltig'; reason: string };

export function verifyCredential(token: string, publicKeyB64u: string, revoked: string[], now = new Date()): CheckResult {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'FVW1') return { ok: false, status: 'ungueltig', reason: 'Kein Ausweis-Code der Fangbuch-App.' };
  try {
    const sig = base64UrlToBytes(parts[2]);
    const msg = utf8Encode(`FVW1.${parts[1]}`);
    const pub = base64UrlToBytes(publicKeyB64u);
    if (!ed25519.verify(sig, msg, pub)) return { ok: false, status: 'ungueltig', reason: 'Signatur ungültig – Ausweis möglicherweise verändert.' };
    const payload = JSON.parse(utf8Decode(base64UrlToBytes(parts[1]))) as CredentialPayload;
    const today = zurichDate(now);
    if (revoked.includes(payload.c)) return { ok: true, status: 'gesperrt', payload };
    if (today < payload.f) return { ok: true, status: 'noch_nicht_gueltig', payload };
    if (today > payload.u) return { ok: true, status: 'abgelaufen', payload };
    return { ok: true, status: 'gueltig', payload };
  } catch {
    return { ok: false, status: 'ungueltig', reason: 'Ausweis-Code konnte nicht gelesen werden.' };
  }
}
