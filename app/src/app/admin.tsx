import { formatDateTimeCH } from '@fvw/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking } from 'react-native';
import { Banner, Button, Card, Pill, Row, Screen, Txt } from '../components/ui';
import { apiFetch } from '../lib/api';
import { useApp } from '../lib/store';

const GROUP: Record<string, string> = { aktive: 'Aktive Fischer', jugend: 'Jugendfischer', tageskarte: 'Tageskarte' };

/** Adminbereich in der App (Kurzübersicht + häufige Aufgaben). Die vollständige Pflege erfolgt in der Admin-Weboberfläche. */
export default function AdminScreen() {
  const { session, online, can, boot } = useApp();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!session || !online) return;
    try { setData(await apiFetch('/app/admin-summary', { token: session.token })); setErr(null); } catch (e: any) { setErr(e.message); }
  }, [session, online]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!can('admin.access')) return <Screen back title="Admin"><Banner kind="warn">Kein Zugriff.</Banner></Screen>;
  return (
    <Screen back title="Adminbereich" testID="screen-admin">
      {!online ? <Banner kind="warn">Der Adminbereich braucht eine Verbindung.</Banner> : null}
      {err ? <Banner kind="error">{err}</Banner> : null}
      {data ? (
        <>
          <Card>
            <Txt bold size={18}>Zu erledigen</Txt>
            <Txt>{`Offene Vorstandsentscheide: ${data.pending.decisions}`}</Txt>
            <Txt>{`Ungeprüfte Gewässervorschläge: ${data.pending.waters}`}</Txt>
            <Txt>{`Offene Sync-Konflikte: ${data.pending.conflicts}`}</Txt>
            <Txt>{`Offene Löschanträge: ${data.pending.deletions}`}</Txt>
            <Txt>{`E-Mails im Postausgang (Entwurf/ausstehend/Fehler): ${data.pending.mails}`}</Txt>
          </Card>
          <Card>
            <Txt bold size={18}>Gewässerkarten</Txt>
            {data.versions.map((v: any, i: number) => (
              <Row key={i}><Txt>{GROUP[v.map_group]}</Txt><Pill label={v.status} kind={v.status === 'aktiv' ? 'success' : 'warn'} />{!v.is_verified_base ? <Pill label="ungeprüfte Basis" kind="warn" /> : null}</Row>
            ))}
            {data.lastCheck.map((c: any) => <Txt key={c.map_group} muted size={14}>{`Prüfung ${GROUP[c.map_group]}: ${c.result} (${formatDateTimeCH(c.checked_at)})`}</Txt>)}
          </Card>
        </>
      ) : null}
      <Button label="News / Gewässerzustand erfassen" kind="primary" onPress={() => router.push('/news')} />
      <Button label="Fänge aller Mitglieder (Fangbuch)" onPress={() => router.push('/fangbuch')} />
      <Button label="Vollständige Adminoberfläche im Browser öffnen" onPress={() => data?.adminWebUrl && Linking.openURL(data.adminWebUrl)} disabled={!data} />
      <Txt muted size={14}>{`Angemeldet als ${boot?.me.displayName}. Alle Rechte werden im Backend geprüft.`}</Txt>
    </Screen>
  );
}
