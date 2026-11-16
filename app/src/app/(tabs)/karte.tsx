import { assessPosition, closuresFor, formatDateCH, MAP_GROUPS, type MapGroup, type Section } from '@fvw/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { Banner, Button, Card, Pill, Row, Screen, Txt } from '../../components/ui';
import { styleFor, WaterMap } from '../../components/WaterMap';
import { kvGet } from '../../lib/db';
import { getConsent, LOCATION_PURPOSE, requestOsPermission, setConsent, useLocation } from '../../lib/location';
import { useApp } from '../../lib/store';
import { space, useColors } from '../../lib/theme';

const STATUS_TEXT: Record<string, { label: string; kind: 'info' | 'warn' | 'error' | 'success' | 'neutral' }> = {
  from_source: { label: 'aus den Kartendaten', kind: 'success' },
  needs_board: { label: 'Vorstandsklärung erforderlich', kind: 'warn' },
  imported_text_only: { label: 'nur importierter Text – nicht bestätigt', kind: 'warn' },
  conflict: { label: 'Angaben widersprüchlich – Vorstandsklärung', kind: 'error' },
  display_only: { label: 'nur Darstellung', kind: 'neutral' },
};

export default function MapScreen() {
  const c = useColors();
  const { boot, maps, activeGroup, setActiveGroup, session } = useApp();
  const [consent, setConsentState] = useState<boolean | null>(null);
  const [askConsent, setAskConsent] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Section | null>(null);
  const [legend, setLegend] = useState(false);
  const [news, setNews] = useState<any[]>([]);
  const { pos, error: locError } = useLocation(!!consent);

  useEffect(() => { getConsent().then(setConsentState); }, []);
  useFocusEffect(useCallback(() => { if (session) kvGet<any[]>(`news:${session.personId}`).then((n) => setNews(n ?? [])); }, [session]));

  const group = activeGroup;
  const bundle = group ? maps[group] : null;
  const closures = bundle?.closures ?? [];
  const conditions = useMemo(() => news.filter((n) => n.category === 'gewaesserzustand' && n.waterKey), [news]);
  const currentConditionKeys = useMemo(() => new Set(conditions.filter((n) => !n.expired).map((n) => n.waterKey as string)), [conditions]);
  const today = new Date().toISOString().slice(0, 10);
  const assessment = useMemo(() => (pos && bundle ? assessPosition([pos.lon, pos.lat], pos.accuracyM, bundle.sections, { toleranceM: boot?.settings.locationToleranceM ?? 50, date: today, closures }) : null), [pos, bundle, boot, today, closures]);

  async function enableLocation() {
    setAskConsent(false);
    await setConsent(true);
    const ok = await requestOsPermission();
    if (!ok) { setPermError('Die Standortfreigabe wurde im Betriebssystem nicht erteilt. Die Karte funktioniert ohne Standort.'); await setConsent(false); setConsentState(false); return; }
    setConsentState(true);
  }
  async function disableLocation() { await setConsent(false); setConsentState(false); }

  if (!boot) return <Screen title="Karte"><Txt>Lade …</Txt></Screen>;
  const groups = boot.mapAccess.groups;
  if (!groups.length || !group || !bundle) {
    return <Screen title="Karte"><Banner kind="warn" title="Keine Gewässerkarte freigegeben">Für Ihre Berechtigung ist aktuell keine Gewässerkarte freigegeben.</Banner></Screen>;
  }
  const titleOf = (g: MapGroup) => ({ aktive: 'Aktive', jugend: 'Jugend', tageskarte: 'Tageskarte' } as Record<MapGroup, string>)[g] ?? MAP_GROUPS.find((x) => x.key === g)?.title ?? g;

  return (
    <Screen title="Karte" scroll={false} testID="screen-map">
      <View style={{ paddingHorizontal: space.s, paddingTop: space.s, paddingBottom: 4, gap: 6 }}>
        {groups.length > 1 ? (
          <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 6 }}>
            {groups.map((g) => <Button key={g} label={titleOf(g)} kind={g === group ? 'primary' : 'secondary'} onPress={() => { setActiveGroup(g); setSelected(null); }} style={{ flex: 1, minHeight: 48, paddingHorizontal: 6 }} testID={`map-group-${g}`} />)}
          </View>
        ) : null}
        {boot.mapAccess.reason === 'info_ohne_patent' ? <Txt size={14} muted>Kein gültiges Patent erfasst – Karte nur zur Information.</Txt> : null}
        {assessment ? (
          <View>
            <Banner kind={assessment.level === 'ok' ? 'success' : assessment.level === 'closed' ? 'error' : 'warn'} title={assessment.level === 'closed' ? 'Gesperrter Bereich' : assessment.level === 'outside' ? 'Ausserhalb' : assessment.level === 'unclear' ? 'Regel ungeklärt' : undefined}>
              {assessment.message}
            </Banner>
            <Txt size={13} muted>GPS ist nur eine ungefähre Orientierung, kein verbindlicher Rechtsnachweis.</Txt>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {consent
            ? <Button label="Standort aus" onPress={disableLocation} style={{ flex: 1, minHeight: 48, paddingHorizontal: 6 }} />
            : <Button label="Standort anzeigen" onPress={() => setAskConsent(true)} style={{ flex: 1, minHeight: 48, paddingHorizontal: 6 }} testID="map-location-on" />}
          {pos ? <Button label="Teilen" onPress={() => Share.share({ message: `Mein Standort (ungefähr): https://map.geo.admin.ch/?swisssearch=${pos.lat.toFixed(5)},${pos.lon.toFixed(5)}` })} style={{ flex: 1, minHeight: 48, paddingHorizontal: 6 }} accessibilityHint="Standort als Link teilen" /> : null}
          <Button label={legend ? 'Legende ✕' : 'Legende'} onPress={() => setLegend(!legend)} style={{ flex: 1, minHeight: 48, paddingHorizontal: 6 }} />
        </View>
        {askConsent ? (
          <Card>
            <Txt bold>Standort verwenden?</Txt>
            <Txt>{LOCATION_PURPOSE}</Txt>
            <Row><Button label="Zustimmen" kind="primary" onPress={enableLocation} style={{ flex: 1 }} /><Button label="Nein, danke" onPress={() => setAskConsent(false)} style={{ flex: 1 }} /></Row>
          </Card>
        ) : null}
        {permError ? <Banner kind="warn">{permError}</Banner> : null}
        {consent && locError ? <Banner kind="warn">{locError}</Banner> : null}
        {legend ? <Legend /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <WaterMap sections={bundle.sections} closures={closures} conditionWaterKeys={currentConditionKeys} location={pos} selectedId={selected?.id ?? null} onSelect={setSelected} attribution={boot.basemap.attribution} />
        {selected ? (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '62%', backgroundColor: c.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: 1, borderColor: c.line }}>
            <ScrollView contentContainerStyle={{ padding: space.l, gap: 8 }}>
              <SectionDetails s={selected} closures={closures} conditions={conditions.filter((n) => n.waterKey === selected.waterKey)} today={today} />
              <Button label="Schliessen" onPress={() => setSelected(null)} />
            </ScrollView>
          </View>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: space.s, paddingVertical: 4, backgroundColor: c.surface, borderTopColor: c.line, borderTopWidth: 1 }}>
        <Text style={{ color: c.muted, fontSize: 13 }} testID="map-version-label">
          {bundle._source === 'bundled' ? bundle._fetchedAt : `Gewässerkarte vom ${bundle.activatedAt ? formatDateCH(bundle.activatedAt) : '–'}${bundle.verifiedBase ? '' : ' (noch nicht als geprüfte Basis bestätigt)'} · offline gespeichert ${bundle._fetchedAt ? formatDateCH(bundle._fetchedAt) : ''}`}
        </Text>
      </View>
    </Screen>
  );
}

function SectionDetails({ s, closures, conditions, today }: { s: Section; closures: any[]; conditions: any[]; today: string }) {
  const active = closuresFor(s, closures, today);
  const upcoming = closures.filter((x) => x.status === 'active' && x.from > today && (x.sectionIds.includes(s.id) || (x.waterKey === s.waterKey && !x.sectionIds.length)));
  const st = STATUS_TEXT[s.ruleStatus] ?? STATUS_TEXT.from_source;
  const closed = s.closed || active.length > 0;
  return (
    <>
      <Txt size={22} bold>{s.name}</Txt>
      {s.name !== s.nameOriginal.trim() ? <Txt muted size={14}>{`In den Kartendaten: «${s.nameOriginal}»`}</Txt> : null}
      {closed ? <Banner kind="error" title="Fischen verboten">{s.conflict ?? (active.length ? `Gesperrt: ${active.map((a) => `${formatDateCH(a.from)}–${formatDateCH(a.to)} (${a.reason})`).join('; ')}` : 'Dieser Abschnitt ist gesperrt.')}</Banner> : null}
      <Row>{s.code !== null ? <Pill label={`Gewässercode ${s.code}`} kind="neutral" /> : <Pill label="kein Gewässercode" kind="neutral" />}<Pill label={st.label} kind={st.kind} /></Row>
      <Txt bold>{s.ruleLabel}</Txt>
      <Txt>{s.ruleMeaning}</Txt>
      {s.riverRules ? <Txt muted>Gilt als Fliessgewässer. Welche Regeln konkret gelten, ist nicht in den Kartendaten hinterlegt (Vorstandsklärung O21).</Txt> : null}
      {s.ruleText ? <Card><Txt muted size={14}>Regeltext aus den Kartendaten:</Txt><Txt>{s.ruleText}</Txt></Card> : null}
      {s.temporalText ? <Banner kind="warn" title="Zeitliche Angabe (Freitext)">{`«${s.temporalText}» – steht nur als Freitext in den Kartendaten und wird nicht als verbindliche Datumsregel ausgewertet. Bitte Vereinsvorgaben beachten.`}</Banner> : null}
      {upcoming.map((u) => <Txt key={u.id}>{`Geplante Sperrung: ${formatDateCH(u.from)}–${formatDateCH(u.to)} (${u.reason})`}</Txt>)}
      {conditions.length ? conditions.map((n) => (
        <Card key={n.id}>
          <Row><Txt bold>{`Gewässerzustand: ${n.title}`}</Txt>{n.expired ? <Pill label="abgelaufen – nicht aktuell" kind="neutral" /> : <Pill label="aktuell" kind="info" />}</Row>
          <Txt muted size={14}>{`${formatDateCH(n.publishedAt)}${n.expiresAt ? ` · gültig bis ${formatDateCH(n.expiresAt)}` : ''}`}</Txt>
          {n.condition?.waterLevel ? <Txt>{`Wasserstand: ${n.condition.waterLevel}`}</Txt> : null}
          {n.condition?.turbidity ? <Txt>{`Trübung: ${n.condition.turbidity}`}</Txt> : null}
          {n.condition?.ice ? <Txt>{`Eis: ${n.condition.ice}`}</Txt> : null}
          {n.condition?.closureNote ? <Txt bold>{`Sperrung: ${n.condition.closureNote}`}</Txt> : null}
          {!n.expired ? <Txt>{n.body}</Txt> : null}
        </Card>
      )) : <Txt muted size={14}>Keine Zustandsmeldung zu diesem Gewässer.</Txt>}
      {s.decisionRefs.length ? <Txt muted size={13}>{`Offene Vorstandsentscheide: ${s.decisionRefs.join(', ')}`}</Txt> : null}
      {s.photoUrls.length ? <Pressable onPress={() => Linking.openURL(s.photoUrls[0])} accessibilityRole="link"><Txt style={{ textDecorationLine: 'underline' }}>Foto ansehen (nur online)</Txt></Pressable> : null}
    </>
  );
}

function Legend() {
  const c = useColors();
  const sample = (s: Partial<Section>, closed = false) => styleFor({ kind: 'water', layerKind: 'baits_all', fishingAllowed: true, ...s } as Section, closed, c, false);
  const items: [string, ReturnType<typeof styleFor>][] = [
    ['Alle Köder erlaubt (inkl. Voralpsee-Text)', sample({ layerKind: 'baits_all' })],
    ['Natur- & Kunstköder ohne Spinner, Löffel, Wobbler (inkl. Kiessämmler)', sample({ layerKind: 'baits_no_spinner' })],
    ['Regel ungeklärt (Vorstandsklärung)', sample({ fishingAllowed: null })],
    ['Gesperrt – Fischen verboten', sample({}, true)],
    ['Pachtgrenze', sample({ kind: 'lease_boundary' })],
    ['Grenze Berg-/Talgewässer (ohne Rechtsfolge)', sample({ kind: 'mountain_valley_boundary' })],
  ];
  return (
    <Card>
      {items.map(([label, st]) => (
        <Row key={label}><View style={{ width: 34, height: 0, borderTopWidth: st.width, borderColor: st.color, borderStyle: st.dash ? 'dashed' : 'solid' }} /><Txt size={15}>{label}</Txt></Row>
      ))}
      <Row><View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#E0A100', borderWidth: 2, borderColor: '#10212A' }} /><Txt size={15}>Vereinslokal / Fischerheim</Txt></Row>
      <Row><View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#1E78FF', borderWidth: 2, borderColor: '#fff' }} /><Txt size={15}>Ihr Standort (nur mit Freigabe)</Txt></Row>
      <Txt muted size={13}>Gewässer antippen für Details. Dickere Linien: aktuelle Zustandsmeldung vorhanden.</Txt>
    </Card>
  );
}
