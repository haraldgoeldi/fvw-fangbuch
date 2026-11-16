import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import { HttpError, type Env } from './authz';
import type { AppContext } from './context';
import { adminRoutes } from './routes/admin-routes';
import { appRoutes, publicRoutes } from './routes/app-routes';

const ADMIN_DIR = resolve(import.meta.dirname, '../admin-web');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function createApp(ctx: AppContext) {
  const app = new Hono<Env>();
  app.use('*', secureHeaders({ crossOriginResourcePolicy: false, crossOriginOpenerPolicy: false }));
  app.use('/api/*', cors({
    origin: ctx.cfg.CORS_ORIGINS === '*' ? '*' : ctx.cfg.CORS_ORIGINS.split(',').map((s) => s.trim()),
    allowHeaders: ['Authorization', 'Content-Type', 'If-None-Match'], exposeHeaders: ['ETag', 'Content-Disposition'], maxAge: 600,
  }));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message, details: err.details }, err.status as any);
    if (err instanceof ZodError) return c.json({ error: 'invalid_input', message: err.issues.map((i) => `${i.path.join('.') || 'Eingabe'}: ${i.message}`).join('; '), details: err.issues }, 400);
    if (err instanceof SyntaxError) return c.json({ error: 'invalid_json', message: 'Ungültige Anfrage (JSON).' }, 400);
    console.error(err);
    return c.json({ error: 'server_error', message: 'Interner Fehler. Bitte später erneut versuchen.' }, 500);
  });
  app.route('/api', publicRoutes(ctx));
  app.route('/api/app', appRoutes(ctx));
  app.route('/api/admin', adminRoutes(ctx));
  app.get('/', (c) => c.redirect('/admin/'));
  app.get('/admin', (c) => c.redirect('/admin/'));
  app.get('/admin/*', (c) => {
    let rel = c.req.path.replace(/^\/admin\/?/, '') || 'index.html';
    if (rel.includes('..')) return c.notFound();
    let f = resolve(ADMIN_DIR, rel);
    if (!existsSync(f)) f = resolve(ADMIN_DIR, 'index.html');
    rel = f;
    return new Response(readFileSync(f), { headers: { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' } });
  });
  return app;
}
