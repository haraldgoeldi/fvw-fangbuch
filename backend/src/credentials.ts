import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

/**
 * Signierter Ausweis (Patent/Tageskarte) für die Offline-Kontrolle:
 *   FVW1.<payload base64url>.<Ed25519-Signatur base64url>
 * Die App des Aufsehers prüft die Signatur offline mit dem öffentlichen Schlüssel.
 * Der Ausweis enthält nur, was auch auf einem Papierpatent steht.
 */
export interface CredentialPayload {
  v: 1;
  /** Ausweis-Prüfnummer (credential_code des Patents). */
  c: string;
  /** Name der Person. */
  n: string;
  /** Patentart. */
  t: string;
  /** Kartengruppe. */
  g: string | null;
  /** gültig von/bis (YYYY-MM-DD). */
  f: string;
  u: string;
  /** Demo-Patent? */
  d?: 1;
  /** Ausgestellt (ISO). */
  i: string;
}

const b64u = (b: Buffer) => b.toString('base64url');

export class CredentialSigner {
  private priv: KeyObject;
  readonly publicKeyB64: string;
  readonly ephemeral: boolean;

  constructor(pkcs8b64?: string) {
    if (pkcs8b64) {
      this.priv = createPrivateKey({ key: Buffer.from(pkcs8b64, 'base64'), format: 'der', type: 'pkcs8' });
      this.ephemeral = false;
    } else {
      this.priv = generateKeyPairSync('ed25519').privateKey;
      this.ephemeral = true;
    }
    const spki = createPublicKey(this.priv).export({ format: 'der', type: 'spki' }) as Buffer;
    // Roh-Schlüssel (letzte 32 Bytes der SPKI-Struktur) – so kann die App ihn direkt verwenden.
    this.publicKeyB64 = b64u(spki.subarray(spki.length - 32));
  }

  sign(p: CredentialPayload): string {
    const payload = b64u(Buffer.from(JSON.stringify(p), 'utf8'));
    const sig = sign(null, Buffer.from(`FVW1.${payload}`), this.priv);
    return `FVW1.${payload}.${b64u(sig)}`;
  }

  verify(token: string): CredentialPayload | null {
    const [pre, payload, sig] = token.split('.');
    if (pre !== 'FVW1' || !payload || !sig) return null;
    const pub = createPublicKey(this.priv);
    if (!verify(null, Buffer.from(`FVW1.${payload}`), pub, Buffer.from(sig, 'base64url'))) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  }
}

export function generateSigningKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64');
}
