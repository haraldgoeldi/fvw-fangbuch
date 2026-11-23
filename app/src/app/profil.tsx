import { formatDateCH } from '@fvw/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Banner, Button, Card, ChoiceGrid, Row, Screen, Txt } from '../components/ui';
import { apiFetch } from '../lib/api';
import { APP_VERSION } from '../lib/config';
import { getConsent, LOCATION_PURPOSE, requestOsPermission, setConsent } from '../lib/location';
import { useApp } from '../lib/store';
import { secureStorageAvailable } from '../lib/secure';
import { setThemeMode, THEME_MODE_LABELS, useThemeMode, type ThemeMode } from '../lib/theme';
import { detailPackageInstalled, downloadDetailPackage } from '../lib/tiles';

export default function ProfileScreen() {
  const { boot, session, online, pending, logout, encryptionDetail } = useApp();
  const [consent, setC] = useState<boolean | null>(null);
  const [ask, setAsk] = useState(false);
  const [detail, setDetail] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const themeMode = useThemeMode();
  useEffect(() => { getConsent().then(setC); detailPackageInstalled().then(setDetail); }, []);
  if (!boot || !session) return <Screen back title="Profil"><Txt>Lade …</Txt></Screen>;

  async function download() {
    setBusy(true); setMsg(null);
    try { await downloadDetailPackage(); setDetail(true); setMsg('Detailkarte gespeichert – sie ist ab sofort offline verfügbar.'); } catch (e: any) { setMsg(`Download fehlgeschlagen: ${e.message}`); } finally { setBusy(false); }
  }
  async function exportData() {
    const res = await apiFetch<Response>('/app/me/export', { token: session!.token, raw: true });
    const text = await res.text();
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'meine-daten.json'; document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    const { File, Paths } = await import('expo-file-system');
    const Sharing = await import('expo-sharing');
    const f = new File(Paths.cache, 'meine-daten.json');
    if (f.exists) f.delete();
    f.create(); f.write(text);
    await Sharing.shareAsync(f.uri, { mimeType: 'application/json', dialogTitle: 'Meine Daten' });
  }
  async function deletion() {
    const r = await apiFetch('/app/me/deletion-request', { token: session!.token, body: {} });
    setMsg(r.message);
  }

  return (
    <Screen back title="Profil" testID="screen-profile">
      <Card>
        <Txt size={20} bold>{boot.me.displayName}</Txt>
        {boot.me.memberNo ? <Txt>{`Mitgliedernummer: ${boot.me.memberNo}`}</Txt> : null}
        {boot.me.email ? <Txt>{`E-Mail: ${boot.me.email}`}</Txt> : null}
        <Txt>{`Rollen: ${boot.me.roles.map((r) => ({ member: 'Mitglied', warden: 'Aufseher', admin: 'Vorstand/Admin', guest: 'Gast' } as any)[r]).join(', ')}`}</Txt>
        {boot.me.accessUntil ? <Txt>{`Gastzugang bis: ${formatDateCH(boot.me.accessUntil)}`}</Txt> : null}
        <Txt muted>{`Angemeldet bis: ${formatDateCH(boot.me.sessionExpiresAt)} (auch offline gültig)`}</Txt>
        <Txt muted size={14}>Name, Nummer und E-Mail stammen aus der Mitgliederverwaltung (Fairgate) bzw. der Tageskarten-Bestellung und werden dort gepflegt.</Txt>
      </Card>

      <Card>
        <Txt size={18} bold>Standort</Txt>
        <Txt>{consent ? 'Eingeschaltet – nur für Karte, Gewässervorschlag und Warnungen.' : 'Ausgeschaltet (Standard).'}</Txt>
        {ask ? (
          <>
            <Txt>{LOCATION_PURPOSE}</Txt>
            <Row>
              <Button label="Zustimmen" kind="primary" onPress={async () => { setAsk(false); await setConsent(true); const ok = await requestOsPermission(); if (!ok) { await setConsent(false); setMsg('Standortfreigabe im Betriebssystem nicht erteilt.'); } setC(ok); }} style={{ flex: 1 }} />
              <Button label="Nein" onPress={() => setAsk(false)} style={{ flex: 1 }} />
            </Row>
          </>
        ) : consent ? <Button label="Standort ausschalten" onPress={async () => { await setConsent(false); setC(false); }} /> : <Button label="Standort einschalten" onPress={() => setAsk(true)} />}
        <Txt muted size={14}>Live-Standort mit ausgewählten Personen teilen ist als spätere Funktion vorgesehen und derzeit deaktiviert.</Txt>
      </Card>

      <Card>
        <Txt size={18} bold>Darstellung</Txt>
        <ChoiceGrid<ThemeMode> label="Farbschema der App" value={themeMode} onChange={setThemeMode} testIDPrefix="theme"
          options={(['light', 'dark', 'system'] as ThemeMode[]).map((v) => ({ value: v, label: THEME_MODE_LABELS[v] }))} />
        <Txt muted size={14}>Standard ist hell. «Wie Gerät» folgt der Einstellung des Handys.</Txt>
      </Card>

      <Card>
        <Txt size={18} bold>Offline-Karte</Txt>
        <Txt>{`Kartenhintergrund: swisstopo LK25. Basis (Zoom 11–14) ist in der App enthalten.`}</Txt>
        {Platform.OS === 'web' ? <Txt muted>Im Browser werden Kacheln online geladen.</Txt> : detail ? <Txt>Detailkarte (bis Zoom 16) ist gespeichert.</Txt> : (
          <Button label="Detailkarte herunterladen (ca. 35 MB, WLAN empfohlen)" onPress={download} busy={busy} disabled={!online || !boot.basemap.variants.includes('detail')} />
        )}
      </Card>

      <Card>
        <Txt size={18} bold>Datenschutz & Sicherheit</Txt>
        <Txt>{`Lokale Verschlüsselung: ${encryptionDetail}`}</Txt>
        <Txt>{`Sitzungsschlüssel: ${secureStorageAvailable ? 'im sicheren Speicher des Geräts' : 'Browser-Speicher (nur Vorschau)'}`}</Txt>
        <Button label="Meine Daten exportieren" onPress={exportData} disabled={!online} />
        <Button label="Löschung meiner Daten beantragen" onPress={deletion} disabled={!online} />
        <Txt muted size={14}>Gespeichert wird höchstens das Gewässer einer Tour – kein Standortverlauf. Fang-, Kontroll- und Kontodaten sehen nur die dafür berechtigten Rollen.</Txt>
      </Card>
      {msg ? <Banner kind="info">{msg}</Banner> : null}

      {confirmLogout ? (
        <Card>
          <Txt bold>{pending ? `${pending} Einträge sind noch nicht übertragen. Sie bleiben auf dem Gerät gespeichert und werden nach der nächsten Anmeldung mit diesem Konto übertragen.` : 'Wirklich abmelden?'}</Txt>
          <Row>
            <Button label="Abmelden" kind="danger" onPress={async () => { await logout(); router.replace('/login'); }} style={{ flex: 1 }} />
            <Button label="Abbrechen" onPress={() => setConfirmLogout(false)} style={{ flex: 1 }} />
          </Row>
        </Card>
      ) : <Button label="Abmelden" kind="danger" onPress={() => setConfirmLogout(true)} />}
      <Txt muted size={13}>{`App-Version ${APP_VERSION} (Prototyp)`}</Txt>
    </Screen>
  );
}
