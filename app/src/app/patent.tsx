import { formatDateCH, formatDateTimeCH } from '@fvw/shared';
import { useState } from 'react';
import { openDayPassShop } from '../components/DayPass';
import { QrCode } from '../components/QrCode';
import { Banner, Button, Card, Pill, Row, Screen, Txt } from '../components/ui';
import { apiFetch, ApiError } from '../lib/api';
import { useApp } from '../lib/store';

/** Ausweis (offline): signierter QR-Code für die Kontrolle durch Aufseher. */
export default function PatentScreen() {
  const { boot, lastSync, session, refresh, online } = useApp();
  const [big, setBig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  /** Neue Tageskarten sofort bei Eventfrog nachschlagen (z. B. direkt nach dem Kauf). */
  async function fetchNew() {
    setBusy(true); setInfo(null);
    try {
      const before = boot?.permits.length ?? 0;
      const r = await apiFetch('/app/permits/refresh', { method: 'POST', body: {}, token: session?.token });
      await refresh();
      setInfo(r.permits.length > before ? 'Neue Tageskarte übernommen.' : r.checked ? 'Keine neue Tageskarte gefunden. Eventfrog braucht nach dem Bezahlen manchmal eine Minute.' : 'Bitte in einer halben Minute nochmals versuchen.');
    } catch (e) {
      setInfo(e instanceof ApiError ? e.message : 'Abfrage fehlgeschlagen.');
    } finally { setBusy(false); }
  }

  async function buy(url: string) {
    await openDayPassShop(url);
    await fetchNew();
  }
  if (!boot) return <Screen back title="Patent"><Txt>Lade …</Txt></Screen>;
  const permits = boot.permits;
  return (
    <Screen back title="Patent / Tageskarte" testID="screen-permit">
      <Banner kind="info">Die Patentverwaltung ist ein Vorschlag und noch nicht vom Vorstand beschlossen (Patentarten, Preise und Abläufe offen). Tageskarten werden über Eventfrog verkauft; die App übernimmt sie automatisch.</Banner>
      {boot.settings.dayPassShopUrl ? (
        <Card>
          <Txt bold>Tageskarte</Txt>
          <Txt muted size={14}>Kauf über Eventfrog mit der E-Mail-Adresse dieses Kontos. Nach dem Schliessen des Shops erscheint die Tageskarte hier.</Txt>
          <Button label="Tageskarte kaufen" kind="primary" onPress={() => buy(boot.settings.dayPassShopUrl!)} disabled={!online} busy={busy} testID="permit-buy-daypass" />
        </Card>
      ) : null}
      {boot.me.kind === 'guest' || boot.settings.dayPassShopUrl ? <Button label="Neue Tageskarten abrufen" kind="secondary" onPress={fetchNew} busy={busy} disabled={!online} testID="permit-refresh" /> : null}
      {info ? <Banner kind="info">{info}</Banner> : null}
      {permits.length === 0 ? <Banner kind="warn" title="Kein Patent / keine Tageskarte">Für Sie ist keine Berechtigung erfasst.</Banner> : null}
      {permits.map((p) => (
        <Card key={p.id} testID={`permit-${p.id}`}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt size={20} bold>{p.typeName}</Txt>
            {p.currentlyValid ? <Pill label="gültig" kind="success" /> : p.status === 'gesperrt' ? <Pill label="gesperrt" kind="error" /> : <Pill label="nicht gültig" kind="warn" />}
          </Row>
          {p.isDemo ? <Pill label="Demo – keine echte Berechtigung" kind="warn" /> : null}
          <Txt size={19}>{boot.me.displayName}</Txt>
          <Txt>{`Gültig ${formatDateCH(p.validFrom)}${p.validTo !== p.validFrom ? ` bis ${formatDateCH(p.validTo)}` : ''}`}</Txt>
          {p.externalRef ? <Txt muted>{`Ticket: ${p.externalRef.split('/').pop()}`}</Txt> : null}
          <Txt muted>{`Ausweis-Nr.: ${p.credentialCode}`}</Txt>
          {p.currentlyValid ? (
            big === p.id ? (
              <>
                <QrCode value={p.credentialToken} size={300} />
                <Txt muted size={14}>Für die Kontrolle durch die Aufsicht. Bildschirm hell stellen. Funktioniert ohne Empfang.</Txt>
                <Button label="QR-Code ausblenden" onPress={() => setBig(null)} />
              </>
            ) : <Button label="Ausweis-QR-Code zeigen" kind="primary" big onPress={() => setBig(p.id)} testID="permit-show-qr" />
          ) : null}
        </Card>
      ))}
      <Txt muted size={13}>{`Stand der Berechtigungen: ${boot.serverTime ? formatDateTimeCH(boot.serverTime) : '–'}${lastSync ? ` · letzte Synchronisation ${formatDateTimeCH(lastSync)}` : ''}`}</Txt>
    </Screen>
  );
}
