import { router } from 'expo-router';
import { Button, Screen, Txt } from '../../components/ui';
import { useApp } from '../../lib/store';

export default function More() {
  const { can, boot } = useApp();
  const items: [string, string, boolean][] = [
    ['Patent / Tageskarte vorweisen', '/patent', true],
    ['News & Gewässerzustand', '/news', true],
    ['Termine & Aktivitäten', '/termine', true],
    ['Meldung: Verschmutzung / tote Fische', '/meldung', can('reports.write')],
    ['Kontrolle (Aufseher)', '/kontrolle', can('controls.write')],
    ['Adminbereich', '/admin', can('admin.access')],
    ['Profil & Einstellungen', '/profil', true],
    ['Synchronisation, offene Punkte, Integrationen', '/status', true],
  ];
  return (
    <Screen title="Mehr" testID="screen-more">
      {items.filter((i) => i[2]).map(([label, href]) => <Button key={href} label={label} onPress={() => router.push(href as any)} style={{ justifyContent: 'flex-start' }} testID={`more-${href.slice(1)}`} />)}
      {boot ? <Txt muted size={14}>{`Angemeldet als ${boot.me.displayName}${boot.me.memberNo ? ` (${boot.me.memberNo})` : ''}`}</Txt> : null}
    </Screen>
  );
}
