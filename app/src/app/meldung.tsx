import { formatDateTimeCH } from '@fvw/shared';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image } from 'react-native';
import { Banner, Button, Card, ChoiceGrid, Field, Pill, Row, Screen, Txt } from '../components/ui';
import { kvGet } from '../lib/db';
import { createReport, listReports, storePhoto } from '../lib/local';
import { currentPosition, getConsent } from '../lib/location';
import { useAfterChange, useApp } from '../lib/store';

const PHOTO_PURPOSE = 'Fotos helfen, die Meldung zu beurteilen. Sie werden zusammen mit der Meldung an den Verein übermittelt und nur dort verwendet.';

export default function ReportScreen() {
  const { session, boot, online } = useApp();
  const after = useAfterChange();
  const [kind, setKind] = useState<'verschmutzung' | 'tote_fische' | 'andere'>('verschmutzung');
  const [desc, setDesc] = useState('');
  const [waterQ, setWaterQ] = useState('');
  const [water, setWater] = useState<{ key: string; name: string } | null>(null);
  const [withLoc, setWithLoc] = useState(false);
  const [photos, setPhotos] = useState<{ id: string; uri: string }[]>([]);
  const [photoHint, setPhotoHint] = useState<'camera' | 'library' | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mine, setMine] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!session) return;
    const local = await listReports(session.personId);
    const delivery = (await kvGet<any>(`delivery:${session.personId}`))?.reports ?? [];
    setMine(local.map((r) => ({ ...r, delivery: delivery.find((d: any) => d.id === r.id)?.deliveryStatus })));
  }, [session]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function addPhoto(source: 'camera' | 'library') {
    setPhotoHint(null);
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setErr('Ohne Freigabe kann kein Foto hinzugefügt werden. Die Meldung funktioniert auch ohne Foto.'); return; }
    const r = source === 'camera' ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (r.canceled || !r.assets?.[0]) return;
    const id = await storePhoto(session!.personId, 'meldung', r.assets[0].uri, r.assets[0].mimeType ?? 'image/jpeg');
    setPhotos((p) => [...p, { id, uri: r.assets[0].uri }]);
  }

  async function submit() {
    setErr(null);
    if (desc.trim().length < 3) { setErr('Bitte beschreiben Sie die Beobachtung.'); return; }
    let location = null;
    if (withLoc) {
      if (!(await getConsent())) { setErr('Standort ist ausgeschaltet (Profil & Einstellungen). Die Meldung wird ohne Standort gesendet, wenn Sie das Häkchen entfernen.'); return; }
      const pos = await currentPosition();
      if (pos) location = { lat: pos.lat, lon: pos.lon, accuracyM: pos.accuracyM };
    }
    await createReport(session!.personId, { kind, description: desc.trim(), waterKey: water?.key ?? null, waterName: water?.name ?? (waterQ.trim() || null), location, photoIds: photos.map((p) => p.id), observedAt: new Date().toISOString() });
    setDesc(''); setWater(null); setWaterQ(''); setPhotos([]); setWithLoc(false);
    setInfo(online ? 'Meldung gespeichert und wird übermittelt.' : 'Meldung sicher gespeichert. Sie wird automatisch übermittelt, sobald Empfang besteht.');
    after(); load();
  }

  const matches = waterQ.trim() && !water ? (boot?.waters ?? []).filter((w) => w.name.toLowerCase().includes(waterQ.toLowerCase())).slice(0, 5) : [];
  return (
    <Screen back title="Meldung" testID="screen-report">
      <Txt>Verschmutzung, tote Fische oder andere Auffälligkeiten melden. Die Meldung geht an die vom Verein festgelegte Adresse.</Txt>
      {info ? <Banner kind="success">{info}</Banner> : null}
      <Card>
        <ChoiceGrid label="Was beobachten Sie?" options={[{ value: 'verschmutzung', label: 'Verschmutzung' }, { value: 'tote_fische', label: 'Tote Fische' }, { value: 'andere', label: 'Anderes' }]} value={kind} onChange={(v) => setKind(v as any)} />
        <Field label="Beschreibung" value={desc} onChangeText={setDesc} multiline placeholder="Was, wo genau, seit wann?" testID="report-desc" />
        <Field label="Gewässer (falls bekannt)" value={water ? water.name : waterQ} onChangeText={(t) => { setWater(null); setWaterQ(t); }} />
        {matches.map((w) => <Button key={w.key} label={w.name} onPress={() => setWater(w)} />)}
        <Button label={withLoc ? '☑ Standort wird mitgesendet' : '☐ Standort mitsenden (freiwillig)'} onPress={() => setWithLoc(!withLoc)} />
        {withLoc ? <Txt muted size={14}>Nur der aktuelle Standort dieser Meldung wird übermittelt – kein Verlauf.</Txt> : null}
        {photoHint ? (
          <Card>
            <Txt>{PHOTO_PURPOSE}</Txt>
            <Row><Button label="Weiter" kind="primary" onPress={() => addPhoto(photoHint)} style={{ flex: 1 }} /><Button label="Abbrechen" onPress={() => setPhotoHint(null)} style={{ flex: 1 }} /></Row>
          </Card>
        ) : (
          <Row>
            <Button label="Foto aufnehmen" onPress={() => setPhotoHint('camera')} style={{ flexGrow: 1 }} />
            <Button label="Foto wählen" onPress={() => setPhotoHint('library')} style={{ flexGrow: 1 }} />
          </Row>
        )}
        <Row>{photos.map((p) => <Image key={p.id} source={{ uri: p.uri }} style={{ width: 80, height: 80, borderRadius: 8 }} accessibilityLabel="Foto zur Meldung" />)}</Row>
        {err ? <Banner kind="error">{err}</Banner> : null}
        <Button label="Meldung senden" kind="primary" big onPress={submit} testID="report-submit" />
        <Txt muted size={14}>{`Datum und Uhrzeit werden automatisch erfasst.`}</Txt>
      </Card>
      <Txt size={19} bold>Meine Meldungen</Txt>
      {mine.length === 0 ? <Txt muted>Noch keine Meldungen.</Txt> : mine.map((r) => (
        <Card key={r.id} testID="report-item">
          <Txt bold>{r.data.kind === 'tote_fische' ? 'Tote Fische' : r.data.kind === 'verschmutzung' ? 'Verschmutzung' : 'Anderes'}{r.data.waterName ? ` · ${r.data.waterName}` : ''}</Txt>
          <Txt muted>{formatDateTimeCH(r.data.observedAt)}</Txt>
          <Pill label={r.syncState !== 'synced' ? (r.syncState === 'pending' ? 'Übermittlung ausstehend' : `Fehler: ${r.syncMessage ?? r.syncState}`) : r.delivery === 'gesendet' ? 'Übermittelt und per E-Mail versendet' : r.delivery === 'entwurf' ? 'Übermittelt (E-Mail im Entwurfsmodus, nicht versendet)' : r.delivery === 'nur_admin' ? 'Übermittelt an den Adminbereich' : 'Übermittelt'} kind={r.syncState === 'synced' ? 'success' : r.syncState === 'pending' ? 'warn' : 'error'} />
        </Card>
      ))}
    </Screen>
  );
}
