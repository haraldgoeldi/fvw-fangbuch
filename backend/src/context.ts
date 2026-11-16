import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins/bearer';
import { emailOTP } from 'better-auth/plugins/email-otp';
import type { Config } from './config';
import { CredentialSigner } from './credentials';
import { createPool, type Db } from './db';
import { createEventfrogAdapter, type EventfrogAdapter } from './integrations/eventfrog';
import { createFairgateAdapter, type FairgateAdapter } from './integrations/fairgate';
import { MailService, PushService } from './integrations/mail';
import { createMyMapsFetcher, type MyMapsFetcher } from './integrations/mymaps';
import { createWebsiteAdapter, type WebsiteAdapter } from './integrations/website';

export function createAuth(cfg: Config, db: Db, mail: () => MailService) {
  return betterAuth({
    database: db,
    secret: cfg.BETTER_AUTH_SECRET,
    baseURL: cfg.PUBLIC_BASE_URL,
    basePath: '/api/auth/ba',
    emailAndPassword: { enabled: false },
    session: { expiresIn: cfg.SESSION_DAYS * 86400, updateAge: 86400 },
    telemetry: { enabled: false },
    rateLimit: { enabled: false },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp }) {
          await mail().send({
            kind: 'otp', to: email,
            subject: 'Ihr Anmeldecode für die Fangbuch-App',
            body: `Ihr Anmeldecode lautet: ${otp}\n\nDer Code ist 10 Minuten gültig. Falls Sie keinen Code angefordert haben, können Sie diese Nachricht ignorieren.\n\nFischereiverein Werdenberg`,
            related: { purpose: 'login' },
          });
        },
      }),
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

export interface AppContext {
  cfg: Config;
  db: Db;
  auth: Auth;
  mail: MailService;
  push: PushService;
  fairgate: FairgateAdapter;
  eventfrog: EventfrogAdapter;
  website: WebsiteAdapter;
  mymaps: MyMapsFetcher;
  signer: CredentialSigner;
  now: () => Date;
}

export function createContext(cfg: Config, overrides: Partial<AppContext> = {}): AppContext {
  const db = overrides.db ?? createPool(cfg.DATABASE_URL);
  let mail: MailService | undefined = overrides.mail;
  const ctx: AppContext = {
    cfg,
    db,
    auth: undefined as unknown as Auth,
    mail: undefined as unknown as MailService,
    push: overrides.push ?? new PushService(cfg, db),
    fairgate: overrides.fairgate ?? createFairgateAdapter(cfg),
    eventfrog: overrides.eventfrog ?? createEventfrogAdapter(cfg),
    website: overrides.website ?? createWebsiteAdapter(cfg),
    mymaps: overrides.mymaps ?? createMyMapsFetcher(cfg),
    signer: overrides.signer ?? new CredentialSigner(cfg.CREDENTIAL_SIGNING_KEY),
    now: overrides.now ?? (() => new Date()),
  };
  mail ??= new MailService(cfg, db);
  ctx.mail = mail;
  ctx.auth = overrides.auth ?? createAuth(cfg, db, () => ctx.mail);
  return ctx;
}
