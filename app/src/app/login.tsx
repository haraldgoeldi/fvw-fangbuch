import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Card, ClubLogo, Field, H1, Row, Txt } from '../components/ui';
import { apiFetch, ApiError } from '../lib/api';
import { API_URL } from '../lib/config';
import { useApp } from '../lib/store';
import { space, useColors } from '../lib/theme';

type Mode = 'email' | 'ticket' | 'access';

export default function Login() {
  const c = useColors();
  const { login, online, session, authProblem, pending } = useApp();
  const [mode, setMode] = useState<Mode>('email');
  const [email, setEmail] = useState('');
  const [ticket, setTicket] = useState('');
  const [code, setCode] = useState('');
  const [access, setAccess] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [demo, setDemo] = useState<{ on: boolean; accounts: any[]; code: string | null }>({ on: false, accounts: [], code: null });

  useEffect(() => {
    apiFetch('/public/config').then(async (cfg) => {
      if (!cfg?.demoMode) return;
      const accounts = await apiFetch('/demo/accounts').catch(() => []);
      setDemo({ on: true, accounts, code: null });
    }).catch(() => {});
  }, []);

  async function request() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch('/auth/request-code', { body: mode === 'email' ? { email: email.trim() } : { ticketNo: ticket.trim() } });
      setMsg(r.message + (r.emailHint ? ` (an ${r.emailHint})` : ''));
      setStep(2);
      if (demo.on && mode === 'email') {
        const mails = await apiFetch(`/demo/mailbox?email=${encodeURIComponent(email.trim())}`).catch(() => []);
        const m = mails?.[0] && /lautet: (\d{6})/.exec(mails[0].body);
        setDemo((d) => ({ ...d, code: m ? m[1] : null }));
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Anfrage fehlgeschlagen.');
    } finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true); setErr(null);
    try {
      const r = mode === 'access'
        ? await apiFetch('/auth/access-code', { body: { code: access.trim() } })
        : await apiFetch('/auth/verify-code', { body: { ...(mode === 'email' ? { email: email.trim() } : { ticketNo: ticket.trim() }), code: code.trim(), device: `${Platform.OS}-App` } });
      await login(r.token);
      router.replace('/');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Anmeldung fehlgeschlagen.');
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.l, gap: space.m, maxWidth: 560, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', gap: 8, marginTop: space.l }}>
            <ClubLogo size={84} />
            <H1>Fangbuch</H1>
            <Txt muted>Fischereiverein Werdenberg</Txt>
          </View>
          {!online ? <Banner kind="warn" title="Keine Verbindung">Für die erste Anmeldung braucht es Internet. Danach funktioniert die App auch ohne Empfang.</Banner> : null}
          {authProblem && pending ? <Banner kind="info">{`${pending} Einträge sind auf diesem Gerät gespeichert und werden nach der Anmeldung übertragen.`}</Banner> : null}
          <Card>
            <Row>
              <Button label="E-Mail" kind={mode === 'email' ? 'primary' : 'secondary'} onPress={() => { setMode('email'); setStep(1); }} style={{ flex: 1 }} />
              <Button label="Ticketnummer" kind={mode === 'ticket' ? 'primary' : 'secondary'} onPress={() => { setMode('ticket'); setStep(1); }} style={{ flex: 1 }} />
            </Row>
            {mode === 'access' ? (
              <>
                <Txt>Zugangscode vom Vorstand (für Mitglieder ohne E-Mail-Adresse):</Txt>
                <Field label="Zugangscode" value={access} onChangeText={setAccess} autoCapitalize="characters" autoCorrect={false} testID="access-code" />
                <Button label="Anmelden" kind="primary" big onPress={verify} busy={busy} disabled={access.trim().length < 6} />
              </>
            ) : step === 1 ? (
              <>
                {mode === 'email' ? (
                  <Field label="E-Mail-Adresse" hint="Mitglieder: die in Fairgate hinterlegte E-Mail. Tageskarte: die E-Mail der Bestellung." value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoCorrect={false} testID="login-email" />
                ) : (
                  <Field label="Ticketnummer der Tageskarte" hint="Der Code wird an die E-Mail-Adresse der Bestellung gesendet." value={ticket} onChangeText={setTicket} autoCapitalize="characters" autoCorrect={false} testID="login-ticket" />
                )}
                <Button label="Code anfordern" kind="primary" big onPress={request} busy={busy} disabled={mode === 'email' ? !/\S+@\S+\.\S+/.test(email) : ticket.trim().length < 3} testID="login-request" />
              </>
            ) : (
              <>
                {msg ? <Txt>{msg}</Txt> : null}
                {demo.code ? <Banner kind="warn" title="Demo-Modus">{`Es wird keine E-Mail versendet. Ihr Demo-Code: ${demo.code}`}</Banner> : null}
                <Field label="6-stelliger Code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" testID="login-code" />
                <Button label="Anmelden" kind="primary" big onPress={verify} busy={busy} disabled={code.length !== 6} testID="login-verify" />
                <Button label="Andere E-Mail / Code erneut anfordern" kind="ghost" onPress={() => setStep(1)} />
              </>
            )}
            {err ? <Banner kind="error">{err}</Banner> : null}
          </Card>
          <Button label={mode === 'access' ? 'Zurück zur Anmeldung per E-Mail' : 'Ich habe keine E-Mail-Adresse (Zugangscode)'} kind="ghost" onPress={() => { setMode(mode === 'access' ? 'email' : 'access'); setErr(null); }} />
          <Txt muted size={14}>Es gibt keine Passwörter. Nach der Anmeldung bleibt die App für längere Zeit angemeldet, damit sie am Wasser auch ohne Empfang funktioniert.</Txt>
          {demo.on ? (
            <Card>
              <Txt bold>Demo-Konten (fiktiv)</Txt>
              {demo.accounts.map((a) => (
                <Button key={a.email} label={`${a.display_name}${a.kind === 'guest' ? ' (Tageskarte)' : ''}${a.eligible ? '' : ' – kein Zugang'}`} kind="secondary" onPress={() => { setMode('email'); setStep(1); setEmail(a.email); }} />
              ))}
              <Txt muted size={13}>{`Server: ${API_URL}`}</Txt>
            </Card>
          ) : null}
          {session ? <Button label="Abbrechen" kind="ghost" onPress={() => router.back()} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
