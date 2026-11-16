import { formatDateCH, formatDateTimeCH, INTEGRATION_MODE_LABELS, type IntegrationMode } from '@fvw/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Banner, Button, Card, Pill, Row, Screen, Txt } from '../components/ui';
import { kvGet } from '../lib/db';
import { problemOps, retryOp } from '../lib/sync';
import { useApp } from '../lib/store';

const MODE_KIND: Record<string, 'success' | 'info' | 'warn' | 'error'> = { active: 'success', test: 'info', not_configured: 'warn', error: 'error' };
const ENTITY: Record<string, string> = { tour: 'Tour', catch: 'Fang', incident_report: 'Meldung', control: 'Kontrolle', violation: 'Vergehen', event_registration: 'Terminanmeldung', water_suggestion: 'Gewässervorschlag' };

export default function StatusScreen() {
  const { boot, session, online, pending, lastSync, lastSyncResult, syncing, sync, maps, refresh } = useApp();
  const [problems, setProblems] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const load = useCallback(async () => {
    if (!session) return;
    setProblems(await problemOps(session.personId));
    setConflicts((await kvGet<any>(`delivery:${session.personId}`))?.conflicts ?? []);
  }, [session]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!boot) return <Screen back title="Status"><Txt>Lade …</Txt></Screen>;
  const open = boot.decisions.filter((d) => d.status === 'offen');

  return (
    <Screen back title="Status" testID="screen-status">
      <Card>
        <Txt size={18} bold>Synchronisation</Txt>
        <Txt>{`Verbindung: ${online ? 'online' : 'offline'}`}</Txt>
        <Txt>{`Ausstehende Uploads: ${pending}`}</Txt>
        <Txt>{`Letzte erfolgreiche Synchronisation: ${lastSync ? formatDateTimeCH(lastSync) : 'noch keine'}`}</Txt>
        {lastSyncResult && !lastSyncResult.ok ? <Banner kind="warn">{`Letzter Versuch ${formatDateTimeCH(lastSyncResult.at)}: ${lastSyncResult.message ?? 'Fehler'} – wird automatisch wiederholt.`}</Banner> : null}
        <Button label="Jetzt synchronisieren" kind="primary" onPress={async () => { await sync(); await refresh(); load(); }} busy={syncing} disabled={!online} testID="sync-now" />
      </Card>
      {problems.length ? (
        <Card>
          <Txt size={18} bold>Nicht übernommene Einträge</Txt>
          <Txt muted size={14}>Nichts wird gelöscht: diese Einträge bleiben gespeichert, bis sie geklärt sind.</Txt>
          {problems.map((p) => (
            <Card key={p.op_id}>
              <Row><Txt bold>{ENTITY[p.entity] ?? p.entity}</Txt><Pill label={p.status === 'conflict' ? 'Konflikt – Vorstand prüft' : 'abgelehnt'} kind="error" /></Row>
              <Txt>{p.last_error ?? ''}</Txt>
              {p.status === 'rejected' ? <Button label="Erneut versuchen" onPress={async () => { await retryOp(p.op_id); await sync(); load(); }} /> : null}
            </Card>
          ))}
        </Card>
      ) : null}
      {conflicts.length ? <Banner kind="warn" title="Konflikte">{`${conflicts.length} Änderung(en) überschneiden sich mit einer Änderung des Vorstands. Ihre Version ist gespeichert und wird geprüft.`}</Banner> : null}

      <Card>
        <Txt size={18} bold>Kartenstand</Txt>
        {boot.mapAccess.groups.map((g) => {
          const m = maps[g];
          return <Txt key={g}>{`${m?.title ?? g}: ${m?._source === 'bundled' ? 'mitgelieferter Stand' : m?.activatedAt ? `vom ${formatDateCH(m.activatedAt)}` : '–'}${m && !m.verifiedBase ? ' (nicht als geprüfte Basis bestätigt)' : ''}`}</Txt>;
        })}
      </Card>

      <Card>
        <Txt size={18} bold>Integrationen</Txt>
        <Txt muted size={14}>Eine Integration gilt erst als funktionsfähig, wenn Zugangsdaten und Freigaben vorliegen.</Txt>
        {boot.integrations.map((i) => (
          <Card key={i.key}>
            <Row><Txt bold>{i.label}</Txt><Pill label={INTEGRATION_MODE_LABELS[i.mode as IntegrationMode] ?? i.mode} kind={MODE_KIND[i.mode] ?? 'neutral' as any} /></Row>
            <Txt size={15}>{i.detail}</Txt>
          </Card>
        ))}
      </Card>

      <Card>
        <Txt size={18} bold>{`Offene Vorstandsentscheide (${open.length})`}</Txt>
        <Txt muted size={14}>Diese Punkte sind noch nicht beschlossen. Die App erfindet dafür keine Regeln oder Werte.</Txt>
        {open.map((d) => (
          <Card key={d.id}>
            <Txt bold>{`${d.id}: ${d.question}`}</Txt>
            <Txt size={15} muted>{`Bis zur Entscheidung: ${d.interim}`}</Txt>
          </Card>
        ))}
      </Card>
    </Screen>
  );
}
