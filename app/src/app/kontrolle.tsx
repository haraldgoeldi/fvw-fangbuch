import { formatDateCH, formatDateTimeCH, type ControlRecord } from '@fvw/shared';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { SignaturePad } from '../components/SignaturePad';
import { Banner, Button, Card, Field, Pill, Row, Screen, Txt } from '../components/ui';
import { apiFetch } from '../lib/api';
import { verifyCredential, type CheckResult } from '../lib/credential';
import { listControls, saveControl, saveViolation, storePhoto } from '../lib/local';
import { newId } from '../lib/sync';
import { useAfterChange, useApp } from '../lib/store';

const RESULT_LABEL: Record<string, string> = { gueltig: 'Gültig', abgelaufen: 'Abgelaufen', noch_nicht_gueltig: 'Noch nicht gültig', gesperrt: 'Gesperrt', ungueltig: 'Ungültig' };

export default function ControlScreen() {
  const { session, boot, online, can } = useApp();
  const after = useAfterChange();
  const [control, setControl] = useState<ControlRecord | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [waterQ, setWaterQ] = useState('');
  const [scan, setScan] = useState(false);
  const [manual, setManual] = useState('');
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [onlineCheck, setOnlineCheck] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [pin, setPin] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [violation, setViolation] = useState(false);
  const [v, setV] = useState({ firstName: '', lastName: '', description: '' });
  const [vPhotos, setVPhotos] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [perm, requestPerm] = useCameraPermissions();
  const w = boot?.warden;

  const load = useCallback(async () => {
    if (!session) return;
    const list = await listControls(session.personId);
    setHistory(list);
    const open = list.find((x) => x.data.status === 'offen');
    if (open && !control) setControl(open.data);
  }, [session, control]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!can('controls.write') || !w || !session) return <Screen back title="Kontrolle"><Banner kind="warn">Nur für Aufseher.</Banner></Screen>;

  async function start(water: { key: string; name: string } | null) {
    const c: ControlRecord = { id: newId(), startedAt: new Date().toISOString(), endedAt: null, waterKey: water?.key ?? null, waterName: water?.name ?? (waterQ.trim() || null),
      checkedCredentialCode: null, credentialResult: null, checkedPersonLabel: null, tourId: null, notes: null, photoIds: [], confirmation: null, status: 'offen', version: 0, updatedAt: new Date().toISOString() };
    await saveControl(session!.personId, c);
    setControl(c); setCheck(null); setNotes(''); setPhotos([]); setMsg(null);
    after();
  }

  function evaluate(token: string) {
    setScan(false); setOnlineCheck(null);
    const t = token.trim();
    if (t.startsWith('FVW1.')) setCheck(verifyCredential(t, w!.publicKey, w!.revoked));
    else setCheck(null);
  }

  async function checkOnline(code: string) {
    try {
      const r = await apiFetch(`/app/warden/credential/${encodeURIComponent(code)}`, { token: session!.token });
      setOnlineCheck(r.found ? `Online-Prüfung: ${r.typeName}, ${formatDateCH(r.validFrom)}–${formatDateCH(r.validTo)} – ${r.valid ? 'gültig' : `nicht gültig (${r.status})`}` : 'Online-Prüfung: Ausweis-Nr. unbekannt');
    } catch (e: any) { setOnlineCheck(`Online-Prüfung nicht möglich: ${e.message}`); }
  }

  async function photo(target: 'kontrolle' | 'vergehen') {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) { setErr('Kamerafreigabe fehlt – Fotos sind optional.'); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (r.canceled || !r.assets?.[0]) return;
    const id = await storePhoto(session!.personId, target, r.assets[0].uri, r.assets[0].mimeType ?? 'image/jpeg');
    if (target === 'kontrolle') setPhotos((x) => [...x, id]); else setVPhotos((x) => [...x, id]);
  }

  async function saveViolationNow() {
    setErr(null);
    const missing = w!.violationRequired.filter((f) => (f === 'photo' ? vPhotos.length === 0 : !(v as any)[f]?.trim()));
    if (missing.length) { setErr(`Pflichtfelder fehlen: ${missing.map((f) => ({ firstName: 'Vorname', lastName: 'Nachname', description: 'Beschreibung', photo: 'Foto' } as any)[f]).join(', ')}`); return; }
    await saveViolation(session!.personId, { id: newId(), controlId: control?.id ?? null, firstName: v.firstName.trim() || null, lastName: v.lastName.trim() || null, description: v.description.trim(), photoIds: vPhotos, createdAt: new Date().toISOString(), version: 0, updatedAt: new Date().toISOString() });
    setViolation(false); setV({ firstName: '', lastName: '', description: '' }); setVPhotos([]);
    setMsg('Meldung eines möglichen Vergehens gespeichert (wird synchronisiert, kein Versand an Behörden).');
    after();
  }

  async function finish() {
    if (!control) return;
    const method = w!.confirmationMethod;
    const confirmation = method === 'pin' ? { method: 'pin' as const, value: pin ? 'bestätigt' : null, at: new Date().toISOString() }
      : method === 'unterschrift' ? { method: 'signature' as const, value: signature, at: new Date().toISOString() }
      : method === 'qr' ? { method: 'qr' as const, value: null, at: null } : null;
    if (method === 'pin' && !pin) { setErr('Bitte PIN eingeben (Bestätigung).'); return; }
    if (method === 'unterschrift' && !signature) { setErr('Bitte unterschreiben.'); return; }
    const done: ControlRecord = { ...control, endedAt: new Date().toISOString(), notes: notes.trim() || null, photoIds: photos,
      checkedCredentialCode: check && check.ok ? check.payload.c : manual.trim() && !manual.startsWith('FVW1.') ? manual.trim() : null,
      credentialResult: check ? (check.ok ? (check.status === 'gueltig' ? 'gueltig' : check.status === 'abgelaufen' ? 'abgelaufen' : 'ungueltig') : 'ungueltig') : manual.trim() ? 'manuell' : 'nicht_geprueft',
      checkedPersonLabel: check && check.ok ? check.payload.n : null, confirmation, status: 'abgeschlossen' };
    await saveControl(session!.personId, done);
    setControl(null); setCheck(null); setManual(''); setPin(''); setSignature(null);
    setMsg(online ? 'Kontrolle abgeschlossen und wird übertragen.' : 'Kontrolle abgeschlossen und offline gespeichert – Übertragung bei Verbindung.');
    after(); load();
  }

  const waterMatches = waterQ.trim() ? (boot?.waters ?? []).filter((x) => x.name.toLowerCase().includes(waterQ.toLowerCase())).slice(0, 5) : [];
  return (
    <Screen back title="Kontrolle" testID="screen-control">
      {msg ? <Banner kind="success">{msg}</Banner> : null}
      {err ? <Banner kind="error">{err}</Banner> : null}
      {!control ? (
        <Card>
          <Txt size={19} bold>Neue Kontrolle</Txt>
          <Field label="Gewässer" value={waterQ} onChangeText={setWaterQ} placeholder="Gewässer suchen" />
          {waterMatches.map((x) => <Button key={x.key} label={x.name} onPress={() => start(x)} />)}
          <Button label="Kontrolle starten" kind="primary" big onPress={() => start(null)} testID="control-start" />
        </Card>
      ) : (
        <>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}><Txt size={19} bold>Kontrolle läuft</Txt><Pill label="offline möglich" kind="info" /></Row>
            <Txt>{`${control.waterName ?? 'Gewässer nicht angegeben'} · seit ${formatDateTimeCH(control.startedAt)}`}</Txt>
          </Card>
          <Card>
            <Txt size={18} bold>Patent / Tageskarte prüfen</Txt>
            {scan ? (
              perm?.granted ? (
                <View style={{ height: 300, borderRadius: 12, overflow: 'hidden' }}>
                  <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(r) => evaluate(r.data)} />
                </View>
              ) : (
                <Card>
                  <Txt>Die Kamera wird nur zum Scannen des Ausweis-QR-Codes verwendet. Es wird kein Bild gespeichert.</Txt>
                  <Button label="Kamera freigeben" kind="primary" onPress={requestPerm} />
                </Card>
              )
            ) : <Button label="QR-Code scannen" kind="primary" onPress={() => setScan(true)} testID="control-scan" />}
            {scan ? <Button label="Scannen abbrechen" onPress={() => setScan(false)} /> : null}
            <Field label="Oder Ausweis-Code / Ausweis-Nr. eingeben" value={manual} onChangeText={setManual} autoCapitalize="none" autoCorrect={false} testID="control-manual" />
            <Row>
              <Button label="Prüfen" onPress={() => evaluate(manual)} disabled={!manual.trim()} style={{ flexGrow: 1 }} testID="control-check" />
              {manual.trim() && !manual.startsWith('FVW1.') ? <Button label="Online prüfen" onPress={() => checkOnline(manual.trim())} disabled={!online} style={{ flexGrow: 1 }} /> : null}
            </Row>
            {check ? (check.ok ? (
              <Banner kind={check.status === 'gueltig' ? 'success' : 'error'} title={RESULT_LABEL[check.status]}>
                {`${check.payload.n} · ${check.payload.t} · ${formatDateCH(check.payload.f)}–${formatDateCH(check.payload.u)}${check.payload.d ? ' · DEMO' : ''} · Nr. ${check.payload.c}${check.status === 'gesperrt' ? ' · auf der Sperrliste' : ''}`}
              </Banner>
            ) : <Banner kind="error" title="Ungültig">{check.reason}</Banner>) : null}
            {onlineCheck ? <Txt>{onlineCheck}</Txt> : null}
            <Txt muted size={13}>Die Signatur wird offline mit dem Schlüssel des Vereins geprüft; gesperrte Ausweise laut letzter Synchronisation.</Txt>
          </Card>
          <Card>
            <Field label="Notizen" value={notes} onChangeText={setNotes} multiline />
            <Button label={`Foto zur Kontrolle (${photos.length})`} onPress={() => photo('kontrolle')} />
          </Card>
          {violation ? (
            <Card style={{ borderWidth: 3 }}>
              <Txt size={18} bold>Mögliches Vergehen melden</Txt>
              <Txt muted size={14}>{`Pflichtfelder (Einstellung des Vereins, noch nicht beschlossen): ${w.violationRequired.join(', ') || 'keine'}`}</Txt>
              <Field label={`Vorname${w.violationRequired.includes('firstName') ? ' *' : ''}`} value={v.firstName} onChangeText={(t) => setV({ ...v, firstName: t })} />
              <Field label={`Nachname${w.violationRequired.includes('lastName') ? ' *' : ''}`} value={v.lastName} onChangeText={(t) => setV({ ...v, lastName: t })} />
              <Field label={`Beschreibung${w.violationRequired.includes('description') ? ' *' : ''}`} value={v.description} onChangeText={(t) => setV({ ...v, description: t })} multiline />
              <Button label={`Foto (${vPhotos.length})${w.violationRequired.includes('photo') ? ' *' : ''}`} onPress={() => photo('vergehen')} />
              <Button label="Vergehen speichern" kind="primary" onPress={saveViolationNow} />
              <Button label="Abbrechen" kind="ghost" onPress={() => setViolation(false)} />
            </Card>
          ) : <Button label="Mögliches Vergehen melden" onPress={() => setViolation(true)} />}
          <Card>
            <Txt size={18} bold>Abschliessen</Txt>
            {w.confirmationMethod === 'nicht_festgelegt' ? <Banner kind="info">Die Art der Bestätigung (QR, PIN oder Unterschrift) ist noch nicht vom Vorstand festgelegt (O3). Die Kontrolle wird ohne Unterzeichnung abgeschlossen.</Banner> : null}
            {w.confirmationMethod === 'pin' ? <Field label="PIN des Aufsehers (Vorschlag)" value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" /> : null}
            {w.confirmationMethod === 'unterschrift' ? <SignaturePad onChange={setSignature} /> : null}
            {w.confirmationMethod === 'qr' ? <Banner kind="info">QR-Bestätigung ist als Option vorgesehen; das genaue Verfahren ist noch offen.</Banner> : null}
            <Button label="Kontrolle abschliessen" kind="primary" big onPress={finish} testID="control-finish" />
            <Txt muted size={13}>Abgeschlossene Kontrollen sind revisionssicher und können nicht mehr geändert werden. Kein automatischer Versand an Behörden.</Txt>
          </Card>
        </>
      )}
      <Txt size={19} bold>Meine Kontrollen</Txt>
      {history.length === 0 ? <Txt muted>Noch keine Kontrollen.</Txt> : history.slice(0, 30).map((h) => (
        <Card key={h.id} testID="control-item">
          <Txt bold>{`${h.data.waterName ?? 'Gewässer –'} · ${formatDateTimeCH(h.data.startedAt)}`}</Txt>
          <Row>
            <Pill label={h.data.status === 'abgeschlossen' ? 'abgeschlossen' : 'offen'} kind={h.data.status === 'abgeschlossen' ? 'success' : 'warn'} />
            <Pill label={h.syncState === 'synced' ? 'synchronisiert' : h.syncState === 'pending' ? 'wartet auf Upload' : `Fehler: ${h.syncMessage ?? ''}`} kind={h.syncState === 'synced' ? 'success' : 'warn'} />
            {h.data.credentialResult ? <Pill label={`Ausweis: ${h.data.credentialResult}`} kind="neutral" /> : null}
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
