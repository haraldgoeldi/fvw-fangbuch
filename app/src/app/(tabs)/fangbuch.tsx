import { catchesToCsv, DISPOSITION_LABELS, formatDateCH, formatDateTimeCH, formatDuration, tourDurationSec, validateLength, zurichDate, type Catch, type CatchDisposition, type Tour } from '@fvw/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { Banner, Button, Card, ChoiceGrid, Field, H2, Pill, Row, Screen, Txt } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { API_URL } from '../../lib/config';
import { deleteCatch, listCatches, listTours, updateCatch } from '../../lib/local';
import { newId } from '../../lib/sync';
import { useAfterChange, useApp } from '../../lib/store';

type Row2 = { id: string; caughtAt: string; species: string; lengthCm: number; disposition: CatchDisposition; waterName: string; member: string; sync?: string; msg?: string | null; tour?: Tour; raw?: Catch };

export default function Fangbuch() {
  const { boot, session, online, can, dataVersion } = useApp();
  const after = useAfterChange();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [period, setPeriod] = useState<'alle' | 'saison' | '30'>('saison');
  const [species, setSpecies] = useState<string | null>(null);
  const [tours, setTours] = useState<Tour[]>([]);
  const [mine, setMine] = useState<Row2[]>([]);
  const [all, setAll] = useState<Row2[] | null>(null);
  const [allErr, setAllErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row2 | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !boot) return;
    const t = await listTours(session.personId);
    const byId = new Map(t.map((x) => [x.id, x]));
    const cs = await listCatches(session.personId);
    setTours(t);
    setMine(cs.map((c) => ({ id: c.id, caughtAt: c.caughtAt, species: c.species, lengthCm: c.lengthCm, disposition: c.disposition, waterName: byId.get(c.tourId)?.waterName ?? '–', member: boot.me.displayName, sync: c._sync, msg: c._msg, tour: byId.get(c.tourId), raw: c })));
  }, [session, boot]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [dataVersion, load]);

  useEffect(() => {
    if (scope !== 'all' || !session) return;
    setAll(null); setAllErr(null);
    if (!online) { setAllErr('Die Liste aller Mitglieder ist nur online verfügbar.'); return; }
    apiFetch<any[]>('/app/catches?scope=all', { token: session.token })
      .then((rows) => setAll(rows.map((r) => ({ id: r.id, caughtAt: r.caughtAt, species: r.species, lengthCm: r.lengthCm, disposition: r.disposition, waterName: r.waterName, member: r.member }))))
      .catch((e) => setAllErr(e.message));
  }, [scope, online, session]);

  const season = boot?.season ?? new Date().getFullYear();
  const rows = useMemo(() => {
    const src = scope === 'all' ? all ?? [] : mine;
    const cutoff = period === '30' ? Date.now() - 30 * 86400_000 : 0;
    return src.filter((r) => (period === 'saison' ? r.caughtAt.startsWith(String(season)) : Date.parse(r.caughtAt) >= cutoff) && (!species || r.species === species));
  }, [scope, all, mine, period, species, season]);

  async function exportCsv() {
    setMsg(null);
    const csv = catchesToCsv(rows.map((r) => ({ caughtAt: r.caughtAt, memberName: r.member, waterName: r.waterName, species: r.species, lengthCm: r.lengthCm, disposition: r.disposition })));
    const name = `faenge-${scope === 'all' ? 'alle' : 'meine'}-${zurichDate(new Date())}.csv`;
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setMsg(`CSV gespeichert (${rows.length} Fänge).`);
      return;
    }
    const { File, Paths } = await import('expo-file-system');
    const Sharing = await import('expo-sharing');
    const f = new File(Paths.cache, name);
    if (f.exists) f.delete();
    f.create();
    f.write(csv);
    await Sharing.shareAsync(f.uri, { mimeType: 'text/csv', dialogTitle: 'Fangliste exportieren', UTI: 'public.comma-separated-values-text' });
  }

  async function seasonNullReport() {
    if (!session) return;
    try {
      await apiFetch('/app/season-report', { token: session.token, body: { id: newId(), season } });
      setMsg(`Saisonmeldung «nicht gefischt» für ${season} übermittelt.`);
    } catch (e: any) { setMsg(`Nicht übermittelt: ${e.message} (bitte online erneut versuchen)`); }
  }

  if (!boot || !session) return <Screen title="Fangbuch"><Txt>Lade …</Txt></Screen>;
  const taken = rows.filter((r) => r.disposition === 'entnommen').length;
  const closedTours = tours.filter((t) => t.status === 'closed');

  return (
    <Screen title="Fangbuch" testID="screen-fangbuch">
      {can('catches.read_all') ? (
        <Row>
          <Button label="Nur meine" kind={scope === 'mine' ? 'primary' : 'secondary'} onPress={() => setScope('mine')} style={{ flex: 1 }} testID="scope-mine" />
          <Button label="Alle Mitglieder" kind={scope === 'all' ? 'primary' : 'secondary'} onPress={() => setScope('all')} style={{ flex: 1 }} testID="scope-all" />
        </Row>
      ) : null}
      <ChoiceGrid label="Zeitraum" options={[{ value: 'saison', label: `Saison ${season}` }, { value: '30', label: '30 Tage' }, { value: 'alle', label: 'Alle' }]} value={period} onChange={(v) => setPeriod(v as any)} columns={3} />
      <Row>
        <Button label={species ? `Art: ${species} ✕` : 'Alle Arten'} kind={species ? 'primary' : 'secondary'} onPress={() => setSpecies(null)} style={{ minHeight: 44 }} />
        {boot.species.filter((s) => s !== species).slice(0, 9).map((s) => <Button key={s} label={s} onPress={() => setSpecies(s)} style={{ minHeight: 44 }} />)}
      </Row>
      {allErr && scope === 'all' ? <Banner kind="warn">{allErr}</Banner> : null}
      <Card>
        <Txt bold>{`${rows.length} Fänge, davon ${taken} entnommen`}</Txt>
        <Button label="Als CSV exportieren" kind="primary" onPress={exportCsv} disabled={!rows.length} testID="csv-export" />
        <Txt muted size={13}>Spalten: Datum, Uhrzeit, Mitglied, Gewässer, Art, Länge, Entnommen (UTF-8, Semikolon – für Excel, Numbers, LibreOffice).</Txt>
        {msg ? <Banner kind="info">{msg}</Banner> : null}
      </Card>

      {editing ? <EditCatch row={editing} species={boot.species} onDone={async (changed) => { setEditing(null); if (changed) { await load(); after(); } }} personId={session.personId} /> : null}

      <H2>Fänge</H2>
      {rows.length === 0 ? <Txt muted>Keine Fänge im gewählten Zeitraum.</Txt> : rows.slice(0, 300).map((r) => (
        <Card key={r.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt bold>{`${r.species} · ${r.lengthCm} cm`}</Txt>
            <Pill label={DISPOSITION_LABELS[r.disposition]} kind={r.disposition === 'entnommen' ? 'error' : 'success'} />
          </Row>
          <Txt muted>{`${formatDateTimeCH(r.caughtAt)} · ${r.waterName}${scope === 'all' ? ` · ${r.member}` : ''}`}</Txt>
          {r.sync && r.sync !== 'synced' ? <Pill label={r.sync === 'pending' ? 'wartet auf Upload' : r.sync === 'conflict' ? 'Konflikt – wird geprüft' : `abgelehnt: ${r.msg ?? ''}`} kind={r.sync === 'pending' ? 'warn' : 'error'} /> : null}
          {scope === 'mine' && r.raw ? <Button label="Korrigieren" kind="ghost" onPress={() => setEditing(r)} /> : null}
        </Card>
      ))}

      {scope === 'mine' ? (
        <>
          <H2>Touren</H2>
          {closedTours.slice(0, 50).map((t) => (
            <Card key={t.id}>
              <Txt bold>{t.waterName}</Txt>
              <Txt muted>{`${formatDateCH(t.startedAt)} · ${formatDuration(tourDurationSec(t))} · ${t.outcome === 'null_report' ? 'Nullmeldung' : 'Fangmeldung'}`}</Txt>
            </Card>
          ))}
          {boot.me.kind === 'member' ? (
            <Card>
              <Txt bold>Saisonmeldung</Txt>
              <Txt>Nicht gefischt in dieser Saison? Melden Sie es hier (zählt als Rückmeldung). Dies ist ein Vorschlag des Prototyps.</Txt>
              <Button label={`Saison ${season}: nicht gefischt melden`} onPress={seasonNullReport} disabled={!online} />
            </Card>
          ) : null}
        </>
      ) : null}
      <Txt muted size={12}>{`Server: ${API_URL}`}</Txt>
    </Screen>
  );
}

function EditCatch({ row, species, onDone, personId }: { row: Row2; species: string[]; onDone: (changed: boolean) => void; personId: string }) {
  const c = row.raw!;
  const closed = row.tour?.status === 'closed';
  const [sp, setSp] = useState(c.species);
  const [len, setLen] = useState(String(c.lengthCm));
  const [disp, setDisp] = useState<CatchDisposition>(c.disposition);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function save(del = false) {
    if (closed && !reason.trim()) { setErr('Die Tour ist abgeschlossen – bitte einen Grund für die Änderung angeben (wird protokolliert).'); return; }
    if (!del) {
      const le = validateLength(Number(len));
      if (le) { setErr(le.message); return; }
      await updateCatch(personId, c, { species: sp, lengthCm: Number(len), disposition: disp }, closed ? reason.trim() : undefined);
    } else {
      await deleteCatch(personId, c, closed ? reason.trim() : undefined);
    }
    onDone(true);
  }
  return (
    <Card style={{ borderWidth: 3 }}>
      <Txt size={19} bold>Fang korrigieren</Txt>
      {closed ? <Banner kind="info">Die Tour ist abgeschlossen. Änderungen werden mit Grund protokolliert.</Banner> : null}
      <ChoiceGrid label="Fischart" options={species.map((s) => ({ value: s, label: s }))} value={sp} onChange={setSp} columns={2} />
      <Field label="Länge in cm" value={len} onChangeText={(t) => setLen(t.replace(/[^0-9]/g, '').slice(0, 3))} keyboardType="number-pad" />
      <ChoiceGrid label="Verbleib" options={[{ value: 'entnommen', label: 'Entnommen' }, { value: 'zurueckgesetzt', label: 'Zurückgesetzt' }]} value={disp} onChange={(v) => setDisp(v as CatchDisposition)} columns={2} />
      {closed ? <Field label="Grund der Änderung" value={reason} onChangeText={setReason} placeholder="z. B. Länge falsch abgelesen" /> : null}
      {err ? <Banner kind="error">{err}</Banner> : null}
      <Row>
        <Button label="Speichern" kind="primary" onPress={() => save(false)} style={{ flex: 1 }} />
        <Button label="Fang löschen" kind="danger" onPress={() => save(true)} style={{ flex: 1 }} />
      </Row>
      <Button label="Abbrechen" kind="ghost" onPress={() => onDone(false)} />
    </Card>
  );
}
