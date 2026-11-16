import { formatDateTimeCH } from '@fvw/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { Banner, Button, Card, Field, Pill, Row, Screen, Txt } from '../components/ui';
import { apiFetch } from '../lib/api';
import { kvGet, kvSet } from '../lib/db';
import { listRegistrations, registerForEvent } from '../lib/local';
import { useAfterChange, useApp } from '../lib/store';

export default function EventsScreen() {
  const { session, online, boot, dataVersion } = useApp();
  const after = useAfterChange();
  const [events, setEvents] = useState<any[]>([]);
  const [regs, setRegs] = useState<Record<string, { sync: string; status?: string }>>({});
  const [stale, setStale] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [count, setCount] = useState('1');
  const [msgText, setMsgText] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const website = boot?.integrations.find((i) => i.key === 'website');

  const load = useCallback(async () => {
    if (!session) return;
    setEvents((await kvGet<any[]>(`events:${session.personId}`)) ?? []);
    const local = await listRegistrations(session.personId);
    const delivery = (await kvGet<any>(`delivery:${session.personId}`))?.registrations ?? [];
    setRegs(Object.fromEntries(local.map((r) => [r.data.eventId, { sync: r.syncState, status: delivery.find((d: any) => d.id === r.id)?.deliveryStatus }])));
    if (!online) { setStale(true); return; }
    try {
      const fresh = await apiFetch<any[]>('/app/events', { token: session.token });
      await kvSet(`events:${session.personId}`, fresh);
      setEvents(fresh); setStale(false);
    } catch { setStale(true); }
  }, [session, online]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [dataVersion, load]);

  async function toCalendar(e: any) {
    const res = await apiFetch<Response>(`/app/events/${e.id}/ics`, { token: session!.token, raw: true });
    const text = await res.text();
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
      const a = document.createElement('a'); a.href = url; a.download = 'termin.ics'; document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    const { File, Paths } = await import('expo-file-system');
    const Sharing = await import('expo-sharing');
    const f = new File(Paths.cache, `termin-${e.id.slice(0, 8)}.ics`);
    if (f.exists) f.delete();
    f.create(); f.write(text);
    await Sharing.shareAsync(f.uri, { mimeType: 'text/calendar', UTI: 'com.apple.ical.ics', dialogTitle: 'In Kalender übernehmen' });
  }

  async function register(e: any) {
    await registerForEvent(session!.personId, e.id, e.title, Math.max(1, Number(count) || 1), msgText.trim() || null);
    setOpen(null); setCount('1'); setMsgText('');
    setInfo(online ? 'Anmeldung wird übermittelt.' : 'Anmeldung gespeichert – wird bei Verbindung übermittelt.');
    after(); load();
  }

  return (
    <Screen back title="Termine" testID="screen-events">
      {website && website.mode !== 'active' ? <Banner kind="info">{`Termine-Quelle: ${website.detail}`}</Banner> : null}
      {stale ? <Banner kind="warn">Offline – gespeicherter Stand der Termine.</Banner> : null}
      {info ? <Banner kind="success">{info}</Banner> : null}
      {events.length === 0 ? <Txt muted>Keine kommenden Termine.</Txt> : events.map((e) => {
        const r = regs[e.id];
        return (
          <Card key={e.id}>
            <Txt size={19} bold>{e.title}</Txt>
            <Txt>{`${formatDateTimeCH(e.startsAt)}${e.location ? ` · ${e.location}` : ''}`}</Txt>
            {e.description ? <Txt muted>{e.description}</Txt> : null}
            <Row>
              <Button label="In Kalender übernehmen" onPress={() => toCalendar(e)} disabled={!online} style={{ flexGrow: 1 }} />
              {e.url ? <Button label="Details (Webseite)" kind="ghost" onPress={() => Linking.openURL(e.url)} /> : null}
            </Row>
            {r ? <Pill label={r.sync !== 'synced' ? 'Anmeldung wartet auf Übermittlung' : r.status === 'gesendet' ? 'Anmeldung versendet' : r.status === 'entwurf' ? 'Anmeldung übermittelt (Versand im Entwurfsmodus)' : 'Anmeldung übermittelt'} kind={r.sync !== 'synced' ? 'warn' : 'success'} /> : open === e.id ? (
              <Card>
                <Field label="Anzahl Personen" value={count} onChangeText={(t) => setCount(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
                <Field label="Nachricht (optional)" value={msgText} onChangeText={setMsgText} multiline />
                <Button label="Anmeldung senden" kind="primary" onPress={() => register(e)} />
                <Button label="Abbrechen" kind="ghost" onPress={() => setOpen(null)} />
              </Card>
            ) : e.registrationEnabled ? <Button label="Anmelden" kind="primary" onPress={() => setOpen(e.id)} /> : null}
          </Card>
        );
      })}
    </Screen>
  );
}
