import { formatDateCH, formatDateTimeCH } from '@fvw/shared';
import { useState } from 'react';
import { QrCode } from '../components/QrCode';
import { Banner, Button, Card, Pill, Row, Screen, Txt } from '../components/ui';
import { useApp } from '../lib/store';

/** Ausweis (offline): signierter QR-Code für die Kontrolle durch Aufseher. */
export default function PatentScreen() {
  const { boot, lastSync } = useApp();
  const [big, setBig] = useState<string | null>(null);
  if (!boot) return <Screen back title="Patent"><Txt>Lade …</Txt></Screen>;
  const permits = boot.permits;
  return (
    <Screen back title="Patent / Tageskarte" testID="screen-permit">
      <Banner kind="info">Die Patentverwaltung ist ein Vorschlag und noch nicht vom Vorstand beschlossen (Patentarten, Preise und Abläufe offen). Die App zeigt nur an – sie verkauft nichts.</Banner>
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
