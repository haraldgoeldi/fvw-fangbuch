#!/usr/bin/env bash
# Startet einen lokalen PostgreSQL-16-Cluster für Entwicklung und Tests (Port 5433).
# Datenverzeichnis: $PGDATA_DIR (Standard: ~/.fvw-pg). Legt fvw_dev und fvw_test an.
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=${PGDATA_DIR:-$HOME/.fvw-pg}
PORT=${PGPORT:-5433}
RUNAS=""
if [ "$(id -u)" = "0" ]; then RUNAS="su postgres -s /bin/bash -c"; fi
run() { if [ -n "$RUNAS" ]; then $RUNAS "$*"; else bash -c "$*"; fi; }
if [ ! -d "$DATA/data" ]; then
  mkdir -p "$DATA"; [ -n "$RUNAS" ] && chown postgres:postgres "$DATA"
  run "$PGBIN/initdb -D $DATA/data -A trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null"
fi
if ! run "$PGBIN/pg_ctl -D $DATA/data status" >/dev/null 2>&1; then
  run "$PGBIN/pg_ctl -D $DATA/data -l $DATA/log -o '-p $PORT -k /tmp' start" >/dev/null
fi
for db in fvw_dev fvw_test; do
  psql -h localhost -p "$PORT" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 || psql -h localhost -p "$PORT" -U postgres -c "CREATE DATABASE $db" >/dev/null
done
echo "PostgreSQL läuft auf localhost:$PORT (Daten: $DATA)"
