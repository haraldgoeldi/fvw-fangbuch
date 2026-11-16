-- Fangbuch- und Patent-App FV Werdenberg – Datenmodell (PostgreSQL 16)
-- Better-Auth-Tabellen (user, session, account, verification) werden separat migriert.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- Personen & Rollen
CREATE TABLE person (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    text UNIQUE,
  kind            text NOT NULL CHECK (kind IN ('member','guest')),
  email           text,
  display_name    text NOT NULL,
  member_no       text,
  fairgate_id     text UNIQUE,
  fairgate_status text,
  fairgate_groups text[] NOT NULL DEFAULT '{}',
  eventfrog_email text,
  eligible        boolean NOT NULL DEFAULT true,
  roles           text[] NOT NULL DEFAULT '{}',
  extra_permissions   text[] NOT NULL DEFAULT '{}',
  revoked_permissions text[] NOT NULL DEFAULT '{}',
  source          text NOT NULL DEFAULT 'app' CHECK (source IN ('fairgate','eventfrog','app','demo')),
  last_sync_at    timestamptz,
  anonymized_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX person_email_kind ON person (lower(email), kind) WHERE email IS NOT NULL AND anonymized_at IS NULL;

-- Vom Vorstand erstellter Einmal-Zugang für Mitglieder ohne E-Mail (Plan B, AD §4)
CREATE TABLE access_code (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES person(id),
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_by  uuid REFERENCES person(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Saison, Patente
CREATE TABLE season (
  year        int PRIMARY KEY,
  label       text NOT NULL,
  starts_on   date,
  ends_on     date,
  note        text
);

CREATE TABLE permit_type (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('saison','tag','spezial')),
  map_group   text CHECK (map_group IN ('aktive','jugend','tageskarte')),
  status      text NOT NULL DEFAULT 'vorschlag' CHECK (status IN ('vorschlag','aktiv','archiviert')),
  is_demo     boolean NOT NULL DEFAULT false,
  eventfrog_ticket_type text,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       uuid NOT NULL REFERENCES person(id),
  permit_type_id  uuid NOT NULL REFERENCES permit_type(id),
  season_year     int REFERENCES season(year),
  valid_from      date NOT NULL,
  valid_to        date NOT NULL,
  status          text NOT NULL DEFAULT 'aktiv' CHECK (status IN ('entwurf','aktiv','gesperrt')),
  payment_status  text NOT NULL DEFAULT 'unbekannt',
  source          text NOT NULL CHECK (source IN ('admin','eventfrog','demo')),
  external_ref    text,
  credential_code text NOT NULL UNIQUE,
  issued_by       uuid REFERENCES person(id),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to >= valid_from)
);
CREATE INDEX permit_person ON permit(person_id);
CREATE UNIQUE INDEX permit_external ON permit(source, external_ref) WHERE external_ref IS NOT NULL;

-- Eventfrog-Bestellungen (nur Felder, die für den Gastzugang nötig sind)
CREATE TABLE guest_order (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_order_id text NOT NULL,
  ticket_no       text,
  email           text NOT NULL,
  buyer_name      text,
  ticket_type     text,
  valid_from      date NOT NULL,
  valid_to        date NOT NULL,
  source          text NOT NULL CHECK (source IN ('eventfrog','demo')),
  person_id       uuid REFERENCES person(id),
  permit_id       uuid REFERENCES permit(id),
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_order_id, ticket_no)
);

-- ---------------------------------------------------------------- Karten & Regeln
CREATE TABLE map_source (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_year int NOT NULL,
  map_group   text NOT NULL CHECK (map_group IN ('aktive','jugend','tageskarte')),
  title       text NOT NULL,
  my_maps_id  text,
  network_link_url text,
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (season_year, map_group)
);

CREATE TABLE map_version (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_year int NOT NULL,
  map_group   text NOT NULL CHECK (map_group IN ('aktive','jugend','tageskarte')),
  source      text NOT NULL CHECK (source IN ('kml_upload','kmz_upload','network_link','bundled')),
  source_name text,
  sha256      text NOT NULL,
  bytes       int NOT NULL,
  kml         text NOT NULL,
  status      text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','aktiv','archiviert','abgelehnt')),
  is_verified_base boolean NOT NULL DEFAULT false,
  stats       jsonb NOT NULL DEFAULT '{}',
  issue_counts jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES person(id),
  activated_at timestamptz,
  activated_by uuid REFERENCES person(id),
  note        text
);
CREATE UNIQUE INDEX map_version_one_active ON map_version(season_year, map_group) WHERE status = 'aktiv';

CREATE TABLE map_check (
  id          bigserial PRIMARY KEY,
  map_group   text NOT NULL,
  season_year int NOT NULL,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  result      text NOT NULL CHECK (result IN ('unveraendert','geaendert','fehler','nicht_eingerichtet')),
  sha256      text,
  map_version_id uuid REFERENCES map_version(id),
  message     text
);

-- Entscheide zu Importbefunden (Normalisierungen) – gelten versionsübergreifend (deterministische IDs)
CREATE TABLE map_issue_decision (
  issue_id    text NOT NULL,
  season_year int NOT NULL,
  status      text NOT NULL CHECK (status IN ('offen','bestaetigt','abgelehnt')),
  value       text,
  note        text,
  decided_by  uuid REFERENCES person(id),
  decided_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, season_year)
);

-- Pflegbare Köderregeln je Ebene (Startwerte aus dem Code, Änderungen versioniert)
CREATE TABLE layer_rule (
  layer_kind  text PRIMARY KEY,
  label       text NOT NULL,
  meaning     text NOT NULL,
  status      text NOT NULL,
  fishing_allowed boolean,
  version     int NOT NULL DEFAULT 1,
  updated_by  uuid REFERENCES person(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE closure (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  water_key   text,
  section_ids text[] NOT NULL DEFAULT '{}',
  map_groups  text[],
  date_from   date NOT NULL,
  date_to     date NOT NULL,
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','revoked')),
  version     int NOT NULL DEFAULT 1,
  created_by  uuid REFERENCES person(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (date_to >= date_from),
  CHECK (water_key IS NOT NULL OR cardinality(section_ids) > 0)
);

-- Gewässer (aus Karte abgeleitet oder von Personen vorgeschlagen)
CREATE TABLE water (
  key         text PRIMARY KEY,
  name        text NOT NULL,
  source      text NOT NULL CHECK (source IN ('karte','person')),
  status      text NOT NULL CHECK (status IN ('aus_karte','ungeprueft','bestaetigt','abgelehnt')),
  map_groups  text[] NOT NULL DEFAULT '{}',
  suggested_by uuid REFERENCES person(id),
  suggestion_id uuid,
  note        text,
  decided_by  uuid REFERENCES person(id),
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fish_species (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  active      boolean NOT NULL DEFAULT true,
  sort        int NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Fangbuch (offline erzeugt, Client-UUIDs)
CREATE TABLE tour (
  id          uuid PRIMARY KEY,
  person_id   uuid NOT NULL REFERENCES person(id),
  water_key   text NOT NULL,
  water_name  text NOT NULL,
  water_unverified boolean NOT NULL DEFAULT false,
  map_group   text,
  permit_id   uuid REFERENCES permit(id),
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  pauses      jsonb NOT NULL DEFAULT '[]',
  outcome     text CHECK (outcome IN ('catch','null_report')),
  status      text NOT NULL CHECK (status IN ('running','closed')),
  version     int NOT NULL DEFAULT 1,
  device_id   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX tour_person ON tour(person_id, started_at DESC);

CREATE TABLE catch (
  id          uuid PRIMARY KEY,
  tour_id     uuid NOT NULL REFERENCES tour(id),
  person_id   uuid NOT NULL REFERENCES person(id),
  species     text NOT NULL,
  length_cm   int NOT NULL CHECK (length_cm BETWEEN 1 AND 150),
  disposition text NOT NULL CHECK (disposition IN ('entnommen','zurueckgesetzt')),
  caught_at   timestamptz NOT NULL,
  version     int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX catch_person ON catch(person_id, caught_at DESC);
CREATE INDEX catch_tour ON catch(tour_id);

-- Saisonmeldung ohne Fischtag (Vorschlag: Mitglied meldet «nicht gefischt»)
CREATE TABLE season_report (
  id          uuid PRIMARY KEY,
  person_id   uuid NOT NULL REFERENCES person(id),
  season_year int NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('nicht_gefischt')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, season_year)
);

-- Revisionsprotokoll: jede Version jedes Datensatzes (Nachvollziehbarkeit, PA §5/§12)
CREATE TABLE record_revision (
  id          bigserial PRIMARY KEY,
  entity      text NOT NULL,
  entity_id   uuid NOT NULL,
  version     int NOT NULL,
  op          text NOT NULL,
  actor_person_id uuid REFERENCES person(id),
  source      text NOT NULL,
  reason      text,
  data        jsonb NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX record_revision_entity ON record_revision(entity, entity_id);

-- Idempotenz der Synchronisation
CREATE TABLE sync_op (
  op_id       uuid PRIMARY KEY,
  person_id   uuid NOT NULL REFERENCES person(id),
  device_id   text,
  entity      text NOT NULL,
  entity_id   uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  result      jsonb NOT NULL
);

CREATE TABLE sync_conflict (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity      text NOT NULL,
  entity_id   uuid NOT NULL,
  person_id   uuid NOT NULL REFERENCES person(id),
  base_version int,
  server_version int NOT NULL,
  client_data jsonb NOT NULL,
  server_data jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution  text,
  resolved_by uuid REFERENCES person(id)
);

-- ---------------------------------------------------------------- Fotos
CREATE TABLE photo (
  id          uuid PRIMARY KEY,
  owner_person_id uuid NOT NULL REFERENCES person(id),
  purpose     text NOT NULL CHECK (purpose IN ('meldung','kontrolle','vergehen','news')),
  mime        text NOT NULL,
  bytes       int NOT NULL,
  sha256      text NOT NULL,
  path        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- ---------------------------------------------------------------- News, Termine, Meldungen
CREATE TABLE news (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  category    text NOT NULL DEFAULT 'allgemein' CHECK (category IN ('allgemein','gewaesserzustand','verein','sperrung')),
  water_key   text,
  water_name  text,
  condition   jsonb,
  visibility  text NOT NULL DEFAULT 'alle' CHECK (visibility IN ('alle','mitglieder')),
  expires_at  timestamptz,
  photo_id    uuid REFERENCES photo(id),
  important   boolean NOT NULL DEFAULT false,
  push_status text,
  version     int NOT NULL DEFAULT 1,
  created_by  uuid REFERENCES person(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  source      text NOT NULL CHECK (source IN ('website','demo','manuell')),
  title       text NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz,
  all_day     boolean NOT NULL DEFAULT false,
  location    text,
  url         text,
  description text,
  registration_enabled boolean NOT NULL DEFAULT true,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  removed_at  timestamptz,
  UNIQUE (source, external_id)
);

CREATE TABLE event_registration (
  id          uuid PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES event(id),
  person_id   uuid NOT NULL REFERENCES person(id),
  participants int NOT NULL DEFAULT 1 CHECK (participants BETWEEN 1 AND 20),
  message     text,
  mail_id     uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE incident_report (
  id          uuid PRIMARY KEY,
  person_id   uuid NOT NULL REFERENCES person(id),
  kind        text NOT NULL CHECK (kind IN ('verschmutzung','tote_fische','andere')),
  description text NOT NULL,
  water_key   text,
  water_name  text,
  location    jsonb,
  photo_ids   uuid[] NOT NULL DEFAULT '{}',
  observed_at timestamptz NOT NULL,
  mail_id     uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Kontrollen (restriktiv)
CREATE TABLE control (
  id          uuid PRIMARY KEY,
  warden_person_id uuid NOT NULL REFERENCES person(id),
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  water_key   text,
  water_name  text,
  credential_code text,
  credential_result text,
  permit_id   uuid REFERENCES permit(id),
  checked_person_id uuid REFERENCES person(id),
  checked_person_label text,
  tour_id     uuid,
  notes       text,
  photo_ids   uuid[] NOT NULL DEFAULT '{}',
  confirmation jsonb,
  status      text NOT NULL CHECK (status IN ('offen','abgeschlossen')),
  version     int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE violation (
  id          uuid PRIMARY KEY,
  control_id  uuid REFERENCES control(id),
  warden_person_id uuid NOT NULL REFERENCES person(id),
  first_name  text,
  last_name   text,
  description text NOT NULL,
  photo_ids   uuid[] NOT NULL DEFAULT '{}',
  version     int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Versand (Entwurf/Mock oder echt)
CREATE TABLE mail_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,
  to_addr     text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  status      text NOT NULL CHECK (status IN ('entwurf','ausstehend','gesendet','fehler')),
  attempts    int NOT NULL DEFAULT 0,
  last_error  text,
  related     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);

CREATE TABLE push_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  audience    text NOT NULL,
  status      text NOT NULL CHECK (status IN ('entwurf','ausstehend','gesendet','fehler')),
  attempts    int NOT NULL DEFAULT 0,
  last_error  text,
  related     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_device (
  token       text PRIMARY KEY,
  person_id   uuid NOT NULL REFERENCES person(id),
  platform    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Integrationen, Einstellungen, Protokoll
CREATE TABLE integration_status (
  key         text PRIMARY KEY,
  mode        text NOT NULL CHECK (mode IN ('not_configured','test','active','error')),
  detail      text,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integration_log (
  id          bigserial PRIMARY KEY,
  key         text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  level       text NOT NULL CHECK (level IN ('info','warnung','fehler')),
  message     text NOT NULL,
  details     jsonb
);

CREATE TABLE app_setting (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  version     int NOT NULL DEFAULT 1,
  updated_by  uuid REFERENCES person(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_setting_history (
  id          bigserial PRIMARY KEY,
  key         text NOT NULL,
  value       jsonb NOT NULL,
  version     int NOT NULL,
  changed_by  uuid REFERENCES person(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE open_decision (
  id          text PRIMARY KEY,
  question    text NOT NULL,
  interim     text NOT NULL,
  status      text NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','entschieden')),
  decision    text,
  decided_at  date,
  updated_by  uuid REFERENCES person(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_person_id uuid,
  actor_label text,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  details     jsonb
);
CREATE INDEX audit_log_at ON audit_log(at DESC);

CREATE TABLE deletion_request (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES person(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','erledigt','abgelehnt')),
  processed_by uuid REFERENCES person(id),
  processed_at timestamptz,
  note        text
);

CREATE TABLE schema_migration (
  name        text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
