import { CameraView, useCameraPermissions } from 'expo-camera';
import * as WebBrowser from 'expo-web-browser';
import { useRef } from 'react';
import { Platform, View } from 'react-native';
import { Banner, Button, Txt } from './ui';

/**
 * Öffnet den Eventfrog-Shop der Tageskarten im In-App-Browser (Android: Custom Tab, iPhone: Safari-Ansicht).
 * Bezahlung, Quittung und Ticket-Mail bleiben bei Eventfrog. Das Versprechen erfüllt sich, wenn der Gast
 * den Shop schliesst; danach holt die App die Tageskarte beim Server ab.
 */
export async function openDayPassShop(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  await WebBrowser.openBrowserAsync(url, { showTitle: true, enableBarCollapsing: true, dismissButtonStyle: 'done' });
}

/**
 * Ticketnummer aus dem QR-Code eines Eventfrog-Tickets.
 * Annahme (noch mit echtem Ticket zu prüfen): Der QR-Code enthält die Prüfnummer des Tickets, die auch unter
 * dem Code gedruckt ist. Steht stattdessen ein Link im Code, wird ein Parameter oder das letzte Wegstück genommen.
 */
export function ticketNoFromQr(raw: string): string | null {
  let s = raw.trim();
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      s = u.searchParams.get('ticket') ?? u.searchParams.get('code') ?? u.searchParams.get('id') ?? u.pathname.split('/').filter(Boolean).pop() ?? '';
    } catch { return null; }
  }
  s = s.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9-]{6,40}$/.test(s) ? s : null;
}

/** Kamera-Ansicht, die den QR-Code eines Eventfrog-Tickets liest. */
export function TicketScanner({ onTicket, onCancel }: { onTicket: (ticketNo: string) => void; onCancel: () => void }) {
  const [perm, requestPerm] = useCameraPermissions();
  const done = useRef(false);
  if (!perm) return <Txt>Kamera wird vorbereitet …</Txt>;
  if (!perm.granted) {
    return (
      <View style={{ gap: 8 }}>
        <Banner kind="info">Für das Scannen des Tickets braucht die App Zugriff auf die Kamera. Die Ticketnummer kann auch abgetippt werden; sie steht unter dem QR-Code.</Banner>
        <Button label="Kamera erlauben" kind="primary" onPress={requestPerm} />
        <Button label="Abbrechen" kind="ghost" onPress={onCancel} />
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <View style={{ height: 300, borderRadius: 12, overflow: 'hidden' }}>
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(r) => {
            const no = ticketNoFromQr(r.data);
            if (no && !done.current) { done.current = true; onTicket(no); }
          }}
        />
      </View>
      <Txt muted size={14}>QR-Code des Eventfrog-Tickets (PDF, Ausdruck oder Wallet) in den Rahmen halten.</Txt>
      <Button label="Scannen abbrechen" onPress={onCancel} testID="ticket-scan-cancel" />
    </View>
  );
}
