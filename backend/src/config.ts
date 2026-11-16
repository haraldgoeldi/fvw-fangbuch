import { z } from 'zod';

/**
 * Konfiguration ausschliesslich über Umgebungsvariablen (.env). Geheimnisse (FSA-Token, Eventfrog-Key,
 * SMTP, Push) liegen nur hier im Backend – nie in der App.
 */
const bool = (def: boolean) => z.enum(['true', 'false', '1', '0']).optional().transform((v) => (v === undefined ? def : v === 'true' || v === '1'));
const optStr = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().min(1).optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8787),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8787'),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET muss mindestens 32 Zeichen lang sein'),
  /** Ed25519-Schlüssel (PKCS8, base64) zum Signieren der Patent-/Tageskarten-Ausweise. */
  CREDENTIAL_SIGNING_KEY: optStr,
  /** Sitzungsdauer in Tagen (offen O9; AD nennt als Beispiel 6–12 Monate). */
  SESSION_DAYS: z.coerce.number().int().min(1).max(730).default(180),
  STORAGE_DIR: z.string().default('./storage'),
  /** Demo-Modus: Mock-Adapter, sichtbarer Demo-Code beim Login. In Produktion verboten. */
  DEMO_MODE: bool(false),
  /** E-Mail-Adressen, die beim ersten Login die Rolle Vorstand/Admin erhalten (nur wenn Rollenquelle = App). */
  ADMIN_BOOTSTRAP_EMAILS: z.string().default(''),
  CORS_ORIGINS: z.string().default('*'),
  JOBS_ENABLED: bool(true),

  FAIRGATE_MODE: z.enum(['off', 'demo', 'live']).default('off'),
  FAIRGATE_BASE_URL: z.string().default('https://fsa.fairgate.ch'),
  FAIRGATE_TOKEN: optStr,
  FAIRGATE_PUBLIC_KEY: optStr,
  FAIRGATE_CONTACTS_PATH: optStr,
  FAIRGATE_FIELD_MAP: optStr,
  FAIRGATE_ELIGIBLE_STATUSES: z.string().default('aktiv'),

  EVENTFROG_MODE: z.enum(['off', 'demo', 'live']).default('off'),
  EVENTFROG_BASE_URL: z.string().default('https://api.eventfrog.net'),
  EVENTFROG_API_KEY: optStr,
  EVENTFROG_ORDERS_PATH: optStr,
  EVENTFROG_FIELD_MAP: optStr,

  MAIL_MODE: z.enum(['draft', 'smtp']).default('draft'),
  SMTP_URL: optStr,
  MAIL_FROM: z.string().default('Fischereiverein Werdenberg <noreply@example.invalid>'),

  PUSH_MODE: z.enum(['off', 'draft', 'expo']).default('draft'),
  EXPO_ACCESS_TOKEN: optStr,

  WEBSITE_MODE: z.enum(['off', 'demo', 'ical', 'rss', 'html']).default('off'),
  WEBSITE_FEED_URL: optStr,

  MYMAPS_MODE: z.enum(['off', 'live', 'file']).default('live'),
  MYMAPS_FILE_DIR: optStr,
});

export type Config = z.infer<typeof schema> & { adminBootstrapEmails: string[]; eligibleStatuses: string[] };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Konfiguration:\n${msg}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production' && c.DEMO_MODE) throw new Error('DEMO_MODE ist in Produktion nicht erlaubt.');
  return {
    ...c,
    adminBootstrapEmails: c.ADMIN_BOOTSTRAP_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    eligibleStatuses: c.FAIRGATE_ELIGIBLE_STATUSES.split(',').map((s) => s.trim()).filter(Boolean),
  };
}
