// Metro-Konfiguration: MBTiles (Offline-Basiskarte) und wa-sqlite (Web) als Assets,
// COOP/COEP-Header für expo-sqlite im Browser (SharedArrayBuffer).
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('mbtiles', 'wasm');
config.server = config.server || {};
const prev = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const mw = prev ? prev(middleware, server) : middleware;
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return mw(req, res, next);
  };
};
module.exports = config;
