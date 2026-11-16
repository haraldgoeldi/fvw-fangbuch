/** Erzeugt einen Ed25519-Schlüssel für CREDENTIAL_SIGNING_KEY. */
import { generateSigningKey } from '../credentials';
console.log(`CREDENTIAL_SIGNING_KEY=${generateSigningKey()}`);
