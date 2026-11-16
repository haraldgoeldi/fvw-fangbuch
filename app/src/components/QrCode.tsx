import QRCode from 'qrcode';
import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

/** QR-Code als reines SVG (funktioniert offline, ohne native Abhängigkeit). */
export function QrCode({ value, size = 260 }: { value: string; size?: number }) {
  const { d, n } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const count = qr.modules.size;
    let path = '';
    for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) if (qr.modules.get(x, y)) path += `M${x},${y}h1v1h-1z`;
    return { d: path, n: count };
  }, [value]);
  const quiet = 4;
  return (
    <View accessibilityLabel="QR-Code des Ausweises für die Kontrolle" style={{ backgroundColor: '#FFFFFF', padding: 8, borderRadius: 8, alignSelf: 'center' }}>
      <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${n + 2 * quiet} ${n + 2 * quiet}`}>
        <Rect x={-quiet} y={-quiet} width={n + 2 * quiet} height={n + 2 * quiet} fill="#FFFFFF" />
        <Path d={d} fill="#000000" />
      </Svg>
    </View>
  );
}
