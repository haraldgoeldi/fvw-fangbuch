import { useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useColors } from '../lib/theme';
import { Button, Row } from './ui';

/** Einfaches Unterschriftenfeld (Vorschlag für die Bestätigung durch Aufseher, O3). Ergebnis: SVG-Pfad. */
export function SignaturePad({ onChange }: { onChange: (svgPath: string | null) => void }) {
  const c = useColors();
  const [paths, setPaths] = useState<string[]>([]);
  const cur = useRef('');
  const [live, setLive] = useState('');
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => { cur.current = `M${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`; setLive(cur.current); },
    onPanResponderMove: (e) => { cur.current += `L${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`; setLive(cur.current); },
    onPanResponderRelease: () => {
      setPaths((p) => { const n = [...p, cur.current]; onChange(n.join('')); return n; });
      setLive('');
    },
  }), [onChange]);
  return (
    <View style={{ gap: 8 }}>
      <View {...pan.panHandlers} accessibilityLabel="Unterschriftenfeld" style={{ height: 160, borderWidth: 2, borderColor: c.line, borderRadius: 12, backgroundColor: '#FFFFFF' }}>
        <Svg width="100%" height="100%" pointerEvents="none">
          {[...paths, live].filter(Boolean).map((d, i) => <Path key={i} d={d} stroke="#10212A" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
        </Svg>
      </View>
      <Row><Button label="Unterschrift löschen" onPress={() => { setPaths([]); onChange(null); }} /></Row>
    </View>
  );
}
