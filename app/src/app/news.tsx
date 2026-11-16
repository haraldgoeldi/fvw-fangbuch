import { formatDateCH } from '@fvw/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Banner, Button, Card, ChoiceGrid, Field, Pill, Row, Screen, Txt } from '../components/ui';
import { apiFetch } from '../lib/api';
import { kvGet, kvSet } from '../lib/db';
import { useApp } from '../lib/store';

const CAT: Record<string, string> = { allgemein: 'Allgemein', gewaesserzustand: 'Gewässerzustand', verein: 'Verein', sperrung: 'Sperrung' };

export default function NewsScreen() {
  const { session, online, can, boot } = useApp();
  const [news, setNews] = useState<any[]>([]);
  const [stale, setStale] = useState(false);
  const [form, setForm] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    const cached = (await kvGet<any[]>(`news:${session.personId}`)) ?? [];
    setNews(cached);
    if (!online) { setStale(true); return; }
    try {
      const fresh = await apiFetch<any[]>('/app/news', { token: session.token });
      await kvSet(`news:${session.personId}`, fresh);
      setNews(fresh); setStale(false);
    } catch { setStale(true); }
  }, [session, online]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <Screen back title="News & Zustand" testID="screen-news">
      {stale ? <Banner kind="warn">Offline – gespeicherter Stand. Neue Meldungen erscheinen bei Verbindung.</Banner> : null}
      {can('news.write') ? (form ? <NewsForm onDone={() => { setForm(false); load(); }} waters={boot?.waters ?? []} /> : <Button label="Beitrag / Gewässerzustand erfassen" kind="primary" onPress={() => setForm(true)} disabled={!online} testID="news-new" />) : null}
      {news.length === 0 ? <Txt muted>Keine Beiträge.</Txt> : news.map((n) => (
        <Card key={n.id}>
          <Row>
            <Pill label={CAT[n.category] ?? n.category} kind={n.category === 'sperrung' ? 'error' : n.category === 'gewaesserzustand' ? 'info' : 'neutral'} />
            {n.expired ? <Pill label="abgelaufen – nicht mehr aktuell" kind="neutral" /> : null}
            {n.visibility === 'mitglieder' ? <Pill label="nur Mitglieder" kind="neutral" /> : null}
            {n.important ? <Pill label="wichtig" kind="warn" /> : null}
          </Row>
          <Txt size={19} bold style={n.expired ? { opacity: 0.6 } : undefined}>{n.title}</Txt>
          <Txt muted size={14}>{`${formatDateCH(n.publishedAt)}${n.waterName ? ` · ${n.waterName}` : ''}${n.expiresAt ? ` · gültig bis ${formatDateCH(n.expiresAt)}` : ''}`}</Txt>
          {n.condition ? (
            <>
              {n.condition.waterLevel ? <Txt>{`Wasserstand: ${n.condition.waterLevel}`}</Txt> : null}
              {n.condition.turbidity ? <Txt>{`Trübung: ${n.condition.turbidity}`}</Txt> : null}
              {n.condition.ice ? <Txt>{`Eis: ${n.condition.ice}`}</Txt> : null}
              {n.condition.closureNote ? <Txt bold>{`Sperrung: ${n.condition.closureNote}`}</Txt> : null}
            </>
          ) : null}
          <Txt style={n.expired ? { opacity: 0.6 } : undefined}>{n.body}</Txt>
        </Card>
      ))}
    </Screen>
  );
}

function NewsForm({ onDone, waters }: { onDone: () => void; waters: { key: string; name: string }[] }) {
  const { session } = useApp();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('allgemein');
  const [waterQ, setWaterQ] = useState('');
  const [water, setWater] = useState<{ key: string; name: string } | null>(null);
  const [level, setLevel] = useState(''); const [turb, setTurb] = useState(''); const [ice, setIce] = useState(''); const [closure, setClosure] = useState('');
  const [visibility, setVisibility] = useState('alle');
  const [days, setDays] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr(null);
    try {
      await apiFetch('/app/news', { token: session!.token, body: {
        title, body, category, waterKey: water?.key ?? null, waterName: water?.name ?? null, visibility,
        condition: category === 'gewaesserzustand' ? { waterLevel: level || null, turbidity: turb || null, ice: ice || null, closureNote: closure || null } : null,
        expiresAt: days ? new Date(Date.now() + Number(days) * 86400_000).toISOString() : null, important: category === 'sperrung',
      } });
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const matches = waterQ.trim() ? waters.filter((w) => w.name.toLowerCase().includes(waterQ.toLowerCase())).slice(0, 5) : [];
  return (
    <Card style={{ borderWidth: 3 }}>
      <Txt size={19} bold>Neuer Beitrag</Txt>
      <ChoiceGrid label="Kategorie" options={Object.entries(CAT).map(([value, label]) => ({ value, label }))} value={category} onChange={setCategory} columns={2} />
      <Field label="Titel" value={title} onChangeText={setTitle} />
      <Field label="Text" value={body} onChangeText={setBody} multiline />
      <Field label="Gewässer (für Gewässerzustand)" value={water ? water.name : waterQ} onChangeText={(t) => { setWater(null); setWaterQ(t); }} />
      {matches.map((w) => <Button key={w.key} label={w.name} onPress={() => { setWater(w); setWaterQ(''); }} />)}
      {category === 'gewaesserzustand' ? (
        <>
          <Field label="Wasserstand" value={level} onChangeText={setLevel} />
          <Field label="Trübung" value={turb} onChangeText={setTurb} />
          <Field label="Eis" value={ice} onChangeText={setIce} />
          <Field label="Sperrung" value={closure} onChangeText={setClosure} />
        </>
      ) : null}
      <ChoiceGrid label="Sichtbar für" options={[{ value: 'alle', label: 'Alle (inkl. Gäste)' }, { value: 'mitglieder', label: 'Nur Mitglieder' }]} value={visibility} onChange={setVisibility} columns={2} />
      <Field label="Läuft ab nach (Tage, optional)" value={days} onChangeText={(t) => setDays(t.replace(/\D/g, ''))} keyboardType="number-pad" />
      {err ? <Banner kind="error">{err}</Banner> : null}
      <Button label="Veröffentlichen" kind="primary" onPress={save} busy={busy} disabled={title.length < 2 || !body} />
      <Button label="Abbrechen" kind="ghost" onPress={onDone} />
    </Card>
  );
}
