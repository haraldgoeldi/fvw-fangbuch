#!/bin/sh
# Startet das Backend im Container.
# - Erzeugt beim ersten Start BETTER_AUTH_SECRET und CREDENTIAL_SIGNING_KEY und legt sie im
#   Volume ab (/app-data/secrets.env), damit Sitzungen und Ausweise einen Neustart überstehen.
#   Werte aus der Umgebung (docker-compose.yml / .env) haben immer Vorrang.
# - Legt im Demo-Modus die Demo-Daten an (mehrfach ausführbar).
set -e
SECRETS="${ENV_FILE:-/app-data/secrets.env}"
mkdir -p "$(dirname "$SECRETS")" "${STORAGE_DIR:-/app-data/storage}"
if [ ! -f "$SECRETS" ]; then
  echo "Erzeuge Schlüssel in $SECRETS (einmalig)"
  {
    echo "BETTER_AUTH_SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))")"
    npx tsx src/cli/keygen.ts
  } > "$SECRETS.tmp"
  chmod 600 "$SECRETS.tmp"
  mv "$SECRETS.tmp" "$SECRETS"
fi
case "${DEMO_MODE:-false}" in
  true|1)
    echo "Demo-Modus: lege Demo-Daten an"
    npx tsx src/cli/seed-demo.ts ;;
esac
exec npx tsx src/server.ts
