import type { MapGroup, Permission, Section } from '@fvw/shared';
import * as Network from 'expo-network';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { apiFetch, ApiError } from './api';
import { BUNDLED_MAP_LABEL } from './config';
import { encryption, getDb, kvGet, kvSet } from './db';
import { secureDelete, secureGet, secureSet } from './secure';
import { foreignPending, newId, pendingCount, syncNow, type SyncSummary } from './sync';

export interface Permit {
  id: string; typeName: string; typeKind: string; typeStatus: string; isDemo: boolean; mapGroup: MapGroup | null; validFrom: string; validTo: string;
  status: string; paymentStatus: string; source: string; externalRef: string | null; credentialCode: string; credentialToken: string; currentlyValid: boolean;
}
export interface Bootstrap {
  serverTime: string; season: number;
  me: { personId: string; kind: 'member' | 'guest'; displayName: string; email: string | null; memberNo: string | null; roles: string[]; permissions: Permission[]; accessUntil: string | null; sessionExpiresAt: string };
  permits: Permit[];
  mapAccess: { groups: MapGroup[]; reason: 'patent' | 'rolle' | 'info_ohne_patent' | 'keine' };
  maps: { group: MapGroup; title: string; etag: string; versionId: string | null; activatedAt: string | null; verifiedBase: boolean; sectionCount: number }[];
  species: string[];
  waters: { key: string; name: string; groups: MapGroup[]; codes: number[]; hasClosedSection: boolean; status: 'aus_karte' | 'bestaetigt' | 'ungeprueft' }[];
  layerRules: Record<string, { label: string; meaning: string; status: string; fishingAllowed: boolean | null }>;
  settings: { permitCheck: 'hinweis' | 'sperre'; locationToleranceM: number; liveLocation: boolean; guestGraceDays: number | null; dayPassShopUrl?: string | null };
  openReports: { permitId: string; name: string; validFrom: string; validTo: string }[];
  warden: { publicKey: string; revoked: string[]; confirmationMethod: string; violationRequired: string[] } | null;
  integrations: { key: string; label: string; mode: string; detail: string; last_success_at: string | null; last_error: string | null }[];
  decisions: { id: string; question: string; interim: string; status: string; decision: string | null }[];
  basemap: { attribution: string; variants: string[] };
}
export interface MapBundle {
  group: MapGroup; title: string; season: number; versionId: string | null; sha256: string | null; verifiedBase: boolean; activatedAt: string | null; etag: string;
  layerRules: Bootstrap['layerRules']; closures: import('@fvw/shared').Closure[]; sections: Section[]; _source?: 'server' | 'bundled'; _fetchedAt?: string;
}

interface Session { token: string; deviceId: string; personId: string }
interface Ctx {
  ready: boolean;
  startError: string | null;
  retryStart: () => void;
  session: Session | null;
  boot: Bootstrap | null;
  online: boolean;
  pending: number;
  foreign: number;
  lastSync: string | null;
  lastSyncResult: (SyncSummary & { at: string }) | null;
  syncing: boolean;
  authProblem: string | null;
  maps: Partial<Record<MapGroup, MapBundle>>;
  mapUpdatedNotice: string | null;
  activeGroup: MapGroup | null;
  setActiveGroup: (g: MapGroup) => void;
  dataVersion: number;
  bumpData: () => void;
  can: (p: Permission) => boolean;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  sync: () => Promise<SyncSummary | null>;
  dismissMapNotice: () => void;
  encryptionDetail: string;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider fehlt');
  return c;
};

const BUNDLED: Record<MapGroup, () => any> = {
  aktive: () => require('../../assets/map-aktive.json'),
  jugend: () => require('../../assets/map-jugend.json'),
  tageskarte: () => require('../../assets/map-tageskarte.json'),
};

export function bundledMap(group: MapGroup): MapBundle {
  const b = BUNDLED[group]();
  return { group, title: b.title, season: 2026, versionId: null, sha256: b.sourceSha256, verifiedBase: false, activatedAt: null, etag: 'bundled', layerRules: {}, closures: [], sections: b.sections, _source: 'bundled', _fetchedAt: BUNDLED_MAP_LABEL };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [foreign, setForeign] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<Ctx['lastSyncResult']>(null);
  const [syncing, setSyncing] = useState(false);
  const [authProblem, setAuthProblem] = useState<string | null>(null);
  const [maps, setMaps] = useState<Ctx['maps']>({});
  const [mapUpdatedNotice, setMapNotice] = useState<string | null>(null);
  const [activeGroup, setActiveGroupState] = useState<MapGroup | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const bumpData = useCallback(() => setDataVersion((v) => v + 1), []);

  const refreshCounts = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    setPending(await pendingCount(s.personId));
    setForeign(await foreignPending(s.personId));
    setLastSync(await kvGet<string>(`last_sync:${s.personId}`));
    setLastSyncResult(await kvGet(`last_sync_result:${s.personId}`));
  }, []);

  const loadMapsFromDb = useCallback(async (groups: MapGroup[]) => {
    const db = await getDb();
    const out: Ctx['maps'] = {};
    for (const g of groups) {
      const r = await db.getFirstAsync<{ data: string; fetched_at: string }>('SELECT data, fetched_at FROM map_bundle WHERE grp=?', g);
      out[g] = r ? { ...JSON.parse(r.data), _source: 'server', _fetchedAt: r.fetched_at } : bundledMap(g);
    }
    setMaps(out);
  }, []);

  /** Bootstrap + Kartenpakete vom Server (nur online). Offline bleibt der gespeicherte Stand gültig. */
  const refresh = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const b = await apiFetch<Bootstrap>('/app/bootstrap', { token: s.token });
      await kvSet(`boot:${s.personId}`, b);
      setBoot(b);
      setAuthProblem(null);
      const db = await getDb();
      const changed: string[] = [];
      for (const m of b.maps) {
        const cur = await db.getFirstAsync<{ etag: string; activated_at: string | null }>('SELECT etag, activated_at FROM map_bundle WHERE grp=?', m.group);
        if (cur?.etag === m.etag) continue;
        const bundle = await apiFetch<MapBundle>(`/app/maps/${m.group}`, { token: s.token, timeoutMs: 60_000 });
        if (!bundle) continue;
        await db.runAsync('INSERT INTO map_bundle(grp, etag, data, fetched_at, activated_at) VALUES (?,?,?,?,?) ON CONFLICT(grp) DO UPDATE SET etag=excluded.etag, data=excluded.data, fetched_at=excluded.fetched_at, activated_at=excluded.activated_at',
          m.group, bundle.etag, JSON.stringify(bundle), new Date().toISOString(), bundle.activatedAt);
        if (cur && cur.activated_at !== bundle.activatedAt && bundle.activatedAt) changed.push(`${bundle.title}: aktualisiert am ${new Date(bundle.activatedAt).toLocaleDateString('de-CH')}`);
      }
      if (changed.length) setMapNotice(`Gewässerkarte aktualisiert – ${changed.join('; ')}`);
      // News (inkl. Gewässerzustand) und Termine für die Offline-Anzeige zwischenspeichern
      try { await kvSet(`news:${s.personId}`, await apiFetch('/app/news', { token: s.token })); } catch { /* später */ }
      try { await kvSet(`events:${s.personId}`, await apiFetch('/app/events', { token: s.token })); } catch { /* später */ }
      await loadMapsFromDb(b.mapAccess.groups);
      setActiveGroupState((g) => (g && b.mapAccess.groups.includes(g) ? g : b.mapAccess.groups[0] ?? null));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setAuthProblem(e.message);
    }
  }, [loadMapsFromDb]);

  const sync = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return null;
    setSyncing(true);
    try {
      const r = await syncNow(s.token, s.personId, s.deviceId);
      if (r.authError) setAuthProblem(r.message ?? 'Bitte erneut anmelden.');
      // Nach jedem Abgleich neu laden: Pull kann Datensätze anderer Geräte gebracht haben
      if (r.ok || r.pushed || r.rejected || r.conflicts) bumpData();
      return r;
    } finally {
      setSyncing(false);
      await refreshCounts();
    }
  }, [bumpData, refreshCounts]);

  // Start: gespeicherte Sitzung laden (offline nutzbar)
  const [startError, setStartError] = useState<string | null>(null);
  const [startAttempt, setStartAttempt] = useState(0);
  useEffect(() => {
    (async () => {
      try { await getDb(); } catch (e: any) { setStartError(`Lokaler Speicher konnte nicht geöffnet werden: ${e?.message ?? e}`); return; }
      setStartError(null);
      const token = await secureGet('session_token');
      const personId = await kvGet<string>('person_id');
      let deviceId = await kvGet<string>('device_id');
      if (!deviceId) { deviceId = newId(); await kvSet('device_id', deviceId); }
      if (token && personId) {
        const cached = await kvGet<Bootstrap>(`boot:${personId}`);
        setSession({ token, deviceId, personId });
        if (cached) {
          setBoot(cached);
          await loadMapsFromDb(cached.mapAccess.groups);
          setActiveGroupState((await kvGet<MapGroup>('active_group')) ?? cached.mapAccess.groups[0] ?? null);
        }
      }
      setReady(true);
    })();
  }, [loadMapsFromDb, startAttempt]);

  // Netzwerkstatus: bei Wiederverbindung automatisch synchronisieren
  useEffect(() => {
    let alive = true;
    Network.getNetworkStateAsync().then((s) => alive && setOnline(!!s.isConnected && s.isInternetReachable !== false)).catch(() => {});
    const sub = Network.addNetworkStateListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false));
    const onWeb = () => setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    if (Platform.OS === 'web' && typeof window !== 'undefined') { window.addEventListener('online', onWeb); window.addEventListener('offline', onWeb); }
    return () => { alive = false; sub.remove(); if (Platform.OS === 'web' && typeof window !== 'undefined') { window.removeEventListener('online', onWeb); window.removeEventListener('offline', onWeb); } };
  }, []);

  useEffect(() => {
    if (!session) return;
    refreshCounts();
    if (online) { refresh(); sync(); }
  }, [session, online, refresh, sync, refreshCounts]);

  // Periodisch und beim Zurückkehren in die App
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => { if (online) sync(); }, 60_000);
    const b = setInterval(() => { if (online) refresh(); }, 15 * 60_000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active' && online) { sync(); refresh(); } });
    return () => { clearInterval(t); clearInterval(b); sub.remove(); };
  }, [session, online, sync, refresh]);

  useEffect(() => { refreshCounts(); }, [dataVersion, refreshCounts]);

  const login = useCallback(async (token: string) => {
    const b = await apiFetch<Bootstrap>('/app/bootstrap', { token });
    await secureSet('session_token', token);
    await kvSet('person_id', b.me.personId);
    await kvSet(`boot:${b.me.personId}`, b);
    let deviceId = await kvGet<string>('device_id');
    if (!deviceId) { deviceId = newId(); await kvSet('device_id', deviceId); }
    setBoot(b);
    setAuthProblem(null);
    setActiveGroupState(b.mapAccess.groups[0] ?? null);
    setSession({ token, deviceId, personId: b.me.personId });
  }, []);

  const logout = useCallback(async () => {
    const s = sessionRef.current;
    if (s) { try { await apiFetch('/auth/logout', { body: {}, token: s.token }); } catch { /* offline */ } }
    await secureDelete('session_token');
    setSession(null);
    setBoot(null);
    setMaps({});
  }, []);

  const setActiveGroup = useCallback((g: MapGroup) => { setActiveGroupState(g); kvSet('active_group', g); }, []);

  const value = useMemo<Ctx>(() => ({
    ready, startError, retryStart: () => setStartAttempt((n) => n + 1), session, boot, online, pending, foreign, lastSync, lastSyncResult, syncing, authProblem, maps, mapUpdatedNotice, activeGroup, setActiveGroup,
    dataVersion, bumpData, can: (p) => !!boot?.me.permissions.includes(p), login, logout, refresh, sync, dismissMapNotice: () => setMapNotice(null), encryptionDetail: encryption.detail,
  }), [ready, startError, session, boot, online, pending, foreign, lastSync, lastSyncResult, syncing, authProblem, maps, mapUpdatedNotice, activeGroup, setActiveGroup, dataVersion, bumpData, login, logout, refresh, sync]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/** Nach jeder lokalen Änderung: Zähler aktualisieren und (falls online) gleich übertragen. */
export function useAfterChange() {
  const { bumpData, sync, online } = useApp();
  return useCallback(() => { bumpData(); if (online) setTimeout(() => { sync(); }, 300); }, [bumpData, sync, online]);
}
