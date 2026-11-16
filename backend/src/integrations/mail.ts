import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config';
import { one, q, type Queryable } from '../db';
import { recordError, recordSuccess } from './status';

export interface MailMessage {
  kind: 'otp' | 'terminanmeldung' | 'meldung' | 'erinnerung' | 'admin_hinweis' | 'zugangscode';
  to: string;
  subject: string;
  body: string;
  related?: Record<string, unknown>;
}

/**
 * E-Mail-Versand. Standard ist der Entwurfsmodus (MAIL_MODE=draft): Nachrichten werden nur im
 * Postausgang gespeichert und im Adminbereich angezeigt – es wird NICHTS versendet.
 * Echter Versand nur mit MAIL_MODE=smtp und gesetztem SMTP_URL.
 */
export class MailService {
  private transport: Transporter | null = null;
  constructor(private cfg: Config, private db: Queryable) {
    if (cfg.MAIL_MODE === 'smtp' && cfg.SMTP_URL) this.transport = nodemailer.createTransport(cfg.SMTP_URL);
  }

  describe() {
    if (this.cfg.MAIL_MODE === 'draft') return { mode: 'test' as const, detail: 'Entwurfsmodus: E-Mails werden nur im Postausgang gespeichert, nicht versendet' };
    if (!this.cfg.SMTP_URL) return { mode: 'not_configured' as const, detail: 'MAIL_MODE=smtp, aber SMTP_URL fehlt – es wird nichts versendet' };
    return { mode: 'active' as const, detail: 'SMTP-Versand aktiv' };
  }

  /** Legt eine Nachricht an und versucht (nur bei aktivem SMTP) sie zu senden. Gibt die Postausgang-ID zurück. */
  async send(m: MailMessage): Promise<{ id: string; status: string }> {
    const draft = !this.transport;
    const row = await one<{ id: string }>(this.db,
      `INSERT INTO mail_outbox(kind, to_addr, subject, body, status, related) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [m.kind, m.to, m.subject, m.body, draft ? 'entwurf' : 'ausstehend', JSON.stringify(m.related ?? {})]);
    if (draft) return { id: row!.id, status: 'entwurf' };
    await this.deliver(row!.id);
    const r = await one<{ status: string }>(this.db, 'SELECT status FROM mail_outbox WHERE id = $1', [row!.id]);
    return { id: row!.id, status: r!.status };
  }

  async deliver(id: string) {
    if (!this.transport) return;
    const m = await one<any>(this.db, 'SELECT * FROM mail_outbox WHERE id = $1', [id]);
    if (!m || m.status === 'gesendet' || m.status === 'entwurf') return;
    try {
      await this.transport.sendMail({ from: this.cfg.MAIL_FROM, to: m.to_addr, subject: m.subject, text: m.body });
      await q(this.db, `UPDATE mail_outbox SET status='gesendet', sent_at=now(), attempts=attempts+1, last_error=null WHERE id=$1`, [id]);
      await recordSuccess(this.db, 'mail', `E-Mail gesendet (${m.kind})`);
    } catch (e: any) {
      await q(this.db, `UPDATE mail_outbox SET status=CASE WHEN attempts+1 >= 5 THEN 'fehler' ELSE 'ausstehend' END, attempts=attempts+1, last_error=$2 WHERE id=$1`, [id, String(e?.message ?? e)]);
      await recordError(this.db, 'mail', `E-Mail-Versand fehlgeschlagen: ${e?.message ?? e}`, { id });
    }
  }

  /** Wiederholung ausstehender Nachrichten (Job). */
  async retryPending() {
    const rows = await q<{ id: string }>(this.db, `SELECT id FROM mail_outbox WHERE status='ausstehend' AND attempts < 5 ORDER BY created_at LIMIT 50`);
    for (const r of rows) await this.deliver(r.id);
    return rows.length;
  }
}

export class PushService {
  constructor(private cfg: Config, private db: Queryable) {}
  describe() {
    if (this.cfg.PUSH_MODE === 'off') return { mode: 'not_configured' as const, detail: 'Nicht eingerichtet (PUSH_MODE=off)' };
    if (this.cfg.PUSH_MODE === 'draft') return { mode: 'test' as const, detail: 'Entwurfsmodus: Push-Nachrichten werden nur protokolliert, nicht versendet' };
    if (!this.cfg.EXPO_ACCESS_TOKEN) return { mode: 'not_configured' as const, detail: 'PUSH_MODE=expo, aber EXPO_ACCESS_TOKEN fehlt' };
    return { mode: 'active' as const, detail: 'Expo Push aktiv' };
  }
  async send(p: { kind: string; title: string; body: string; audience: string; related?: Record<string, unknown> }) {
    const d = this.describe();
    const status = d.mode === 'active' ? 'ausstehend' : 'entwurf';
    const row = await one<{ id: string }>(this.db, `INSERT INTO push_outbox(kind, title, body, audience, status, related) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [p.kind, p.title, p.body, p.audience, status, JSON.stringify(p.related ?? {})]);
    if (d.mode !== 'active') return { id: row!.id, status };
    try {
      const tokens = await q<{ token: string }>(this.db, 'SELECT token FROM push_device');
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.EXPO_ACCESS_TOKEN}` },
        body: JSON.stringify(tokens.map((t) => ({ to: t.token, title: p.title, body: p.body }))),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await q(this.db, `UPDATE push_outbox SET status='gesendet', attempts=attempts+1 WHERE id=$1`, [row!.id]);
      await recordSuccess(this.db, 'push', 'Push gesendet');
      return { id: row!.id, status: 'gesendet' };
    } catch (e: any) {
      await q(this.db, `UPDATE push_outbox SET status='fehler', attempts=attempts+1, last_error=$2 WHERE id=$1`, [row!.id, String(e?.message ?? e)]);
      await recordError(this.db, 'push', `Push fehlgeschlagen: ${e?.message ?? e}`);
      return { id: row!.id, status: 'fehler' };
    }
  }
}
