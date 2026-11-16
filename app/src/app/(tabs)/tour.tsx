import {
  DISPOSITION_LABELS, formatDateTimeCH, formatDuration, formatTimeCH, isPaused, suggestWaters, tourDurationSec, validateCatch, validateLength,
  type Catch, type CatchDisposition, type MapGroup, type Section, type Tour,
} from '@fvw/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Card, ChoiceGrid, Field, H2, Pill, Row, Screen, Txt } from '../../components/ui';
import { addCatch, deleteCatch, endTour, listCatches, pauseTour, resumeTour, runningTour, startTour, suggestWater } from '../../lib/local';
import { currentPosition, getConsent } from '../../lib/location';
import { useAfterChange, useApp } from '../../lib/store';

export default function TourScreen() {
  const { boot, session, maps, activeGroup, dataVersion } = useApp();
  const after = useAfterChange();
  const [tour, setTour] = useState<Tour | null>(null);
  const [catches, setCatches] = useState<(Catch & { _sync: string })[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [closedInfo, setClosedInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    const t = await runningTour(session.personId);
    setTour(t);
    setCatches(t ? (await listCatches(session.personId)).filter((c) => c.tourId === t.id) : []);
    setLoaded(true);
  }, [session]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [dataVersion, load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  if (!boot || !session || !loaded) return <Screen title="Fischen"><Txt>Lade …</Txt></Screen>;
  return (
    <Screen title="Fischen" testID="screen-tour">
      {closedInfo ? <Banner kind="success" title="Tour abgeschlossen" action={{ label: 'OK', onPress: () => setClosedInfo(null) }}>{closedInfo}</Banner> : null}
      {tour
        ? <RunningTour tour={tour} catches={catches} now={now} species={boot.species} onChanged={async () => { await load(); after(); }} onClosed={(msg) => { setClosedInfo(msg); load(); after(); }} />
        : <StartTour sectionsByGroup={Object.fromEntries(Object.entries(maps).map(([g, m]) => [g, m?.sections ?? []])) as Record<string, Section[]>} activeGroup={activeGroup} onStarted={async () => { setClosedInfo(null); await load(); after(); }} />}
    </Screen>
  );
}

// ---------------------------------------------------------------- Tour starten

function StartTour({ sectionsByGroup, activeGroup, onStarted }: { sectionsByGroup: Record<string, Section[]>; activeGroup: MapGroup | null; onStarted: () => void }) {
  const { boot, session } = useApp();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ key: string; name: string; groups: MapGroup[]; hasClosedSection: boolean; status: string } | null>(null);
  const [suggestions, setSuggestions] = useState<{ waterKey: string; name: string; distanceM: number; closed: boolean }[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [newWater, setNewWater] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waters = boot!.waters;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? waters.filter((w) => w.name.toLowerCase().includes(q)) : waters;
    return list.slice(0, q ? 12 : 6);
  }, [query, waters]);

  async function locate() {
    setLocating(true); setErr(null);
    try {
      if (!(await getConsent())) { setErr('Standort ist ausgeschaltet. Unter «Mehr → Profil & Einstellungen» können Sie ihn freiwillig einschalten.'); return; }
      const pos = await currentPosition();
      if (!pos) { setErr('Kein Standort verfügbar. Bitte Gewässer aus der Liste wählen.'); return; }
      const secs = Object.values(sectionsByGroup).flat();
      setSuggestions(suggestWaters([pos.lon, pos.lat], secs, 3));
    } finally { setLocating(false); }
  }

  const validPermits = boot!.permits.filter((p) => p.currentlyValid);
  const matchingPermit = selected ? validPermits.find((p) => p.mapGroup && selected.groups.includes(p.mapGroup)) ?? null : null;
  const permitMissing = !!selected && !matchingPermit && selected.status === 'aus_karte';
  const blocked = permitMissing && boot!.settings.permitCheck === 'sperre';

  async function start() {
    if (!selected || !session) return;
    setBusy(true);
    try {
      const group: MapGroup | null = matchingPermit?.mapGroup ?? (activeGroup && selected.groups.includes(activeGroup) ? activeGroup : selected.groups[0] ?? null);
      await startTour(session.personId, { waterKey: selected.key, waterName: selected.name, waterUnverified: selected.status === 'ungeprueft', mapGroup: group, permitId: matchingPermit?.id ?? null });
      onStarted();
    } finally { setBusy(false); }
  }

  async function addWater() {
    if (!session || newWater.trim().length < 2) return;
    const w = await suggestWater(session.personId, newWater, activeGroup);
    setSelected({ key: w.waterKey, name: w.name, groups: activeGroup ? [activeGroup] : [], hasClosedSection: false, status: 'ungeprueft' });
    setShowNew(false); setNewWater('');
  }

  return (
    <>
      <Txt size={20} bold>1. Gewässer wählen</Txt>
      <Card>
        <Button label={locating ? 'Standort wird bestimmt …' : 'Gewässer anhand meines Standorts vorschlagen'} onPress={locate} busy={locating} />
        {suggestions ? (suggestions.length ? suggestions.map((s) => {
          const w = waters.find((x) => x.key === s.waterKey);
          return <Button key={s.waterKey} label={`${s.name} (ca. ${s.distanceM} m)${s.closed ? ' – Teile gesperrt' : ''}`} kind={selected?.key === s.waterKey ? 'primary' : 'secondary'} onPress={() => w && setSelected(w)} />;
        }) : <Txt muted>Kein Gewässer dieser Karte in der Nähe (1,5 km).</Txt>) : null}
        {suggestions ? <Txt muted size={14}>Vorschlag aus GPS – bitte prüfen. GPS ist nur eine ungefähre Orientierung.</Txt> : null}
        <Field label="Gewässer suchen" value={query} onChangeText={setQuery} placeholder="z. B. Binnenkanal" testID="water-search" autoCorrect={false} />
        {filtered.map((w) => (
          <Button key={w.key} testID={`water-${w.key}`} label={`${w.name}${w.status === 'ungeprueft' ? ' (ungeprüft)' : ''}`} kind={selected?.key === w.key ? 'primary' : 'secondary'} onPress={() => setSelected(w)} />
        ))}
        {!showNew ? <Button label="Gewässer fehlt in der Liste?" kind="ghost" onPress={() => setShowNew(true)} /> : (
          <View style={{ gap: 8 }}>
            <Field label="Name des fehlenden Gewässers" value={newWater} onChangeText={setNewWater} hint="Wird als «ungeprüft» gespeichert und gilt erst nach Bestätigung durch den Vorstand für alle." />
            <Button label="Gewässer erfassen" onPress={addWater} disabled={newWater.trim().length < 2} />
          </View>
        )}
      </Card>
      {err ? <Banner kind="warn">{err}</Banner> : null}
      {selected ? (
        <>
          <Txt size={20} bold>{`2. Start am Gewässer «${selected.name}»`}</Txt>
          {selected.status === 'ungeprueft' ? <Banner kind="info">Neu erfasstes Gewässer – ungeprüft, bis der Vorstand es bestätigt.</Banner> : null}
          {selected.hasClosedSection ? <Banner kind="error" title="Achtung: gesperrte Abschnitte">Teile dieses Gewässers sind gesperrt. Bitte vor dem Fischen auf der Karte prüfen.</Banner> : null}
          {permitMissing ? (
            <Banner kind={blocked ? 'error' : 'warn'} title={blocked ? 'Start nicht möglich' : 'Hinweis'}>
              {`Für dieses Gewässer liegt kein passendes gültiges Patent bzw. keine Tageskarte vor.${blocked ? '' : ' Sie können trotzdem starten (Einstellung des Vereins: nur Hinweis).'}`}
            </Banner>
          ) : null}
          <Button label="Start" kind="success" big icon="▶" onPress={start} busy={busy} disabled={blocked} testID="tour-start" />
          <Txt muted size={14}>Datum und Uhrzeit werden automatisch erfasst. Der Standort wird nicht gespeichert – nur das gewählte Gewässer.</Txt>
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- Laufende Tour

function RunningTour({ tour, catches, now, species, onChanged, onClosed }: { tour: Tour; catches: (Catch & { _sync: string })[]; now: number; species: string[]; onChanged: () => void; onClosed: (msg: string) => void }) {
  const { session } = useApp();
  // Werte zusätzlich synchron in Refs halten: «Fang speichern» liest immer die zuletzt getippten Werte,
  // auch wenn schnell hintereinander getippt wird (React-Zustand ist asynchron).
  const [sp, setSpState] = useState<string | null>(null);
  const [len, setLenState] = useState('');
  const [disp, setDispState] = useState<CatchDisposition | null>(null);
  const cur = useRef<{ sp: string | null; len: string; disp: CatchDisposition | null }>({ sp: null, len: '', disp: null });
  const setSp = (v: string | null) => { cur.current.sp = v; setSpState(v); };
  const setLen = (v: string) => { cur.current.len = v; setLenState(v); };
  const setDisp = (v: CatchDisposition | null) => { cur.current.disp = v; setDispState(v); };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const paused = isPaused(tour);
  const pid = session!.personId;

  async function save() {
    const { sp: s0, len: l0, disp: d0 } = cur.current;
    const n = Number(l0.replace(',', '.'));
    const errs = validateCatch({ species: s0 ?? undefined, lengthCm: n, disposition: d0 ?? undefined, caughtAt: new Date().toISOString() }, tour, species);
    if (errs.length) { setErrors(Object.fromEntries(errs.map((e) => [e.field, e.message]))); return; }
    setErrors({});
    try {
      await addCatch(pid, tour.id, { species: s0!, lengthCm: n, disposition: d0! });
    } catch (e: any) {
      setErrors({ save: `Speichern fehlgeschlagen: ${e?.message ?? e}. Bitte erneut versuchen – Ihre Eingaben sind noch im Formular.` });
      return;
    }
    setSaved(`${s0}, ${n} cm, ${DISPOSITION_LABELS[d0!]} – gespeichert`);
    setSp(null); setLen(''); setDisp(null);
    onChanged();
  }

  async function close(outcome: 'catch' | 'null_report') {
    await endTour(pid, tour, outcome);
    setConfirmStop(false);
    onClosed(outcome === 'null_report'
      ? `Nullmeldung für «${tour.waterName}» gespeichert. Sie zählt als Rückmeldung.`
      : `Fangmeldung mit ${catches.length} ${catches.length === 1 ? 'Fang' : 'Fängen'} für «${tour.waterName}» gespeichert.`);
  }

  return (
    <>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt size={20} bold>{tour.waterName}</Txt>
          {paused ? <Pill label="Pausiert" kind="warn" /> : <Pill label="Tour läuft" kind="success" />}
        </Row>
        <Txt muted>{`Gestartet ${formatDateTimeCH(tour.startedAt)}`}</Txt>
        <Txt size={40} bold accessibilityRole="timer" testID="tour-timer">{formatDuration(tourDurationSec(tour, new Date(now)))}</Txt>
        <Row>
          <Button label={paused ? 'Weiter' : 'Pause'} onPress={async () => { await (paused ? resumeTour(pid, tour) : pauseTour(pid, tour)); onChanged(); }} style={{ flex: 1 }} testID="tour-pause" />
          <Button label="Stop" kind="danger" onPress={() => setConfirmStop(true)} style={{ flex: 1 }} testID="tour-stop" />
        </Row>
      </Card>

      {confirmStop ? (
        <Card style={{ borderWidth: 3 }}>
          <Txt size={20} bold>Tour wirklich beenden?</Txt>
          <Txt>{catches.length ? `Sie haben ${catches.length} ${catches.length === 1 ? 'Fang' : 'Fänge'} erfasst.` : 'Es ist noch kein Fang erfasst.'}</Txt>
          {catches.length
            ? <Button label={`Beenden und Fangmeldung (${catches.length}) abschliessen`} kind="primary" big onPress={() => close('catch')} testID="tour-close-catch" />
            : <Button label="Kein Fang – Nullmeldung abschliessen" kind="primary" big onPress={() => close('null_report')} testID="tour-close-null" />}
          <Button label="Weiterfischen" onPress={() => setConfirmStop(false)} />
        </Card>
      ) : null}

      <H2>Fang erfassen</H2>
      <Card>
        <ChoiceGrid label="Fischart" options={species.map((s) => ({ value: s, label: s }))} value={sp} onChange={setSp} columns={2} testIDPrefix="species" />
        {errors.species ? <Txt style={{ color: '#A8302A' }} bold>{errors.species}</Txt> : null}
        <Field label="Länge in cm" value={len} onChangeText={(t) => setLen(t.replace(/[^0-9]/g, '').slice(0, 3))} keyboardType="number-pad" placeholder="z. B. 32" error={errors.lengthCm ?? (len && validateLength(Number(len)) ? validateLength(Number(len))!.message : null)} testID="catch-length" />
        <ChoiceGrid label="Verbleib" options={[{ value: 'entnommen', label: 'Entnommen' }, { value: 'zurueckgesetzt', label: 'Zurückgesetzt' }]} value={disp} onChange={(v) => setDisp(v as CatchDisposition)} columns={2} testIDPrefix="disp" />
        {errors.disposition ? <Txt style={{ color: '#A8302A' }} bold>{errors.disposition}</Txt> : null}
        <Button label="Fang speichern" kind="primary" big onPress={save} testID="catch-save" />
        {errors.save ? <Banner kind="error">{errors.save}</Banner> : null}
        {saved ? <Banner kind="success">{saved}</Banner> : null}
        <Txt muted size={14}>Der Zeitpunkt wird automatisch gesetzt. Die Längenprüfung ist eine technische Plausibilitätsprüfung (1–150 cm), kein Mindestmass.</Txt>
      </Card>

      <H2>{`Fänge dieser Tour (${catches.length})`}</H2>
      {catches.length === 0 ? <Txt muted>Noch kein Fang erfasst.</Txt> : catches.map((c) => (
        <Card key={c.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt bold>{`${c.species} · ${c.lengthCm} cm · ${DISPOSITION_LABELS[c.disposition]}`}</Txt>
            <Pill label={c._sync === 'synced' ? 'übertragen' : c._sync === 'pending' ? 'wartet' : c._sync} kind={c._sync === 'synced' ? 'success' : 'warn'} />
          </Row>
          <Txt muted>{formatTimeCH(c.caughtAt)}</Txt>
          {confirmDelete === c.id ? (
            <Row>
              <Button label="Wirklich löschen" kind="danger" onPress={async () => { await deleteCatch(pid, c); setConfirmDelete(null); onChanged(); }} style={{ flex: 1 }} />
              <Button label="Abbrechen" onPress={() => setConfirmDelete(null)} style={{ flex: 1 }} />
            </Row>
          ) : <Button label="Löschen" kind="ghost" onPress={() => setConfirmDelete(c.id)} />}
        </Card>
      ))}
      <Button label="Karte anzeigen" kind="ghost" onPress={() => router.push('/karte')} />
    </>
  );
}
