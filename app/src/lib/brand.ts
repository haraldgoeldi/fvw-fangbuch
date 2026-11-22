import type { ImageSourcePropType } from 'react-native';

/**
 * Vereinslogo (geliefert 21.11.2026). Gegenüber der Originaldatei ist nur der leere, transparente
 * Rand abgeschnitten, damit das runde Logo im Kopf zentriert und gross genug erscheint.
 * Das Logo wird proportional (resizeMode="contain") und unverändert angezeigt.
 */
export const LOGO: ImageSourcePropType | null = require('../../assets/logo-transparent.png');
