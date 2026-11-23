import { formatDateCH, formatDateTimeCH, formatDuration, tourDurationSec, zurichDate, type Tour } from '@fvw/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Banner, Button, Card, H2, Pill, Row, Screen, Txt } from '../../components/ui';
import { kvGet } from '../../lib/db';
import { listTours } from '../../lib/local';
import { useApp } from '../../lib/store';

export default function Dashboard() {
  const { boot, session, online, pending, mapUpdatedNotice, dismissMapNotice, dataVersion, foreign } = useApp();
  const [tours, setTours] = useState<Tour[]>([]);
  const [news, setNews] = useState<any[]>([]);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    if (!session) return;
    setTours(await listTours(session.personId));
    setNews((await kvGet<any[]>(`news:${session.personId}`)) ?? []);
  }, [session]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [dataVersion, load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  if (!boot || !session) return <Screen title="Start"><Txt>Lade …</Txt></Screen>;
  const running = tours.find((t) => t.status === 'running');
  const closedDates = tours.filter((t) => t.status === 'closed' && t.outcome).map((t) => zurichDate(t.startedAt));
  const openReports = boot.openReports.filter((o) => !closedDates.some((d) => d >= o.validFrom && d <= o.validTo));
  const today = zurichDate(new Date());
  const valid = boot.permits.filter((p) => p.currentlyValid);
  const soon = valid.filter((p) => (Date.parse(p.validTo) - Date.now()) / 86400_000 < 14 && p.typeKind !== 'tag');
  const latestNews = news.filter((n) => !n.expired).slice(0, 2);
  const roleLabel = boot.me.kind === 'guest' ? 'Gast (Tageskarte)' : boot.me.roles.includes('admin') ? 'Vorstand/Admin' : boot.me.roles.includes('warden') ? 'Aufseher' : 'Mitglied';

  return (
    <Screen title="Start" testID="screen-start">
      <Txt size={22} bold>{`Petri Heil, ${boot.me.displayName}`}</Txt>
      <Row><Pill label={roleLabel} />{boot.permits.some((p) => p.isDemo) ? <Pill label="Demo-Daten" kind="warn" /> : null}</Row>

      {!online ? (
        <Banner kind="warn" title="Offline">{`Alle Eingaben werden sicher auf dem Gerät gespeichert${pending ? ` (${pending} warten auf Upload)` : ''} und automatisch übertragen, sobald wieder Empfang besteht.`}</Banner>
      ) : pending ? <Banner kind="info">{`${pending} Einträge werden übertragen …`}</Banner> : null}
      {foreign ? <Banner kind="warn">{`${foreign} Einträge eines anderen Kontos auf diesem Gerät warten auf dessen Anmeldung.`}</Banner> : null}
      {mapUpdatedNotice ? <Banner kind="success" title="Gewässerkarte aktualisiert" action={{ label: 'OK', onPress: dismissMapNotice }}>{mapUpdatedNotice}</Banner> : null}

      {running ? (
        <Card>
          <Txt bold size={19}>{`Tour läuft: ${running.waterName}`}</Txt>
          <Txt>{`Seit ${formatDateTimeCH(running.startedAt)} · Fischzeit ${formatDuration(tourDurationSec(running, new Date(now)))}`}</Txt>
          <Button label="Weiter zur Tour" kind="success" big onPress={() => router.push('/tour')} testID="dash-continue-tour" />
        </Card>
      ) : (
        <Button label="Tour starten" kind="success" big icon="▶" onPress={() => router.push('/tour')} testID="dash-start-tour" />
      )}

      {openReports.map((o) => (
        <Banner key={o.permitId} kind="warn" title="Fangmeldung offen" action={{ label: 'Jetzt melden (Fang oder Nullmeldung)', onPress: () => router.push('/tour') }}>
          {`${o.name}, ${formatDateCH(o.validFrom)}${o.validTo !== o.validFrom ? ` – ${formatDateCH(o.validTo)}` : ''}: Es liegt noch keine Fang- oder Nullmeldung vor.`}
        </Banner>
      ))}

      <H2>Patent / Tageskarte</H2>
      {valid.length ? (
        <Card>
          {valid.map((p) => <Txt key={p.id}>{`✓ ${p.typeName} – gültig bis ${formatDateCH(p.validTo)}`}</Txt>)}
          {soon.map((p) => <Banner key={p.id} kind="warn">{`${p.typeName} läuft am ${formatDateCH(p.validTo)} ab.`}</Banner>)}
          <Button label="Ausweis vorweisen" kind="primary" onPress={() => router.push('/patent')} testID="dash-show-permit" />
        </Card>
      ) : (
        <Banner kind="warn" title="Kein gültiges Patent hinterlegt">
          {boot.me.kind === 'member' ? 'Für Sie ist aktuell kein gültiges Patent erfasst. Die Gewässerkarten werden zur Information angezeigt.' : 'Für Sie ist aktuell keine gültige Tageskarte erfasst.'}
        </Banner>
      )}

      {latestNews.length ? <H2>Neuigkeiten</H2> : null}
      {latestNews.map((n) => (
        <Card key={n.id}><Txt bold>{n.title}</Txt><Txt muted size={14}>{formatDateCH(n.publishedAt)}</Txt><Txt numberOfLines={3}>{n.body}</Txt></Card>
      ))}
      <Txt muted size={13}>{`Heute: ${formatDateCH(today)}`}</Txt>
    </Screen>
  );
}
