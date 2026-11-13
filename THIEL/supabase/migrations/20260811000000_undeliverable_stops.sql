-- =============================================================
-- Thiel Dienstleistungen – „Nicht lieferbar" an Tour-Stopps
-- Migration 20260811000000
--
-- Stopps können als „nicht lieferbar" markiert werden (Objekt zu,
-- Zutritt verweigert, Schlüssel fehlt, ...) – optional mit Grund.
-- Dadurch kann eine Tour auch dann abgeschlossen werden, wenn
-- nicht alle Stopps beliefert wurden (keine falschen „beliefert"-
-- Haken mehr). Belieferung (is_delivered) und „nicht lieferbar"
-- schließen sich gegenseitig aus; die bestehenden Trigger
-- (last_delivery, is_reserved-Reset) greifen nur bei echter
-- Belieferung und bleiben unverändert.
--
-- Idempotent: `add column if not exists` – kann bedenkenlos
-- mehrfach ausgeführt werden (Supabase SQL-Editor).
-- =============================================================

alter table public.tour_stops
  add column if not exists is_undeliverable boolean not null default false;

alter table public.tour_stops
  add column if not exists undeliverable_reason text;

comment on column public.tour_stops.is_undeliverable is
  'Stopp konnte nicht beliefert werden (Objekt zu, Zutritt verweigert, ...). Schließt is_delivered aus.';

comment on column public.tour_stops.undeliverable_reason is
  'Optionaler Grund, warum der Stopp nicht beliefert werden konnte (z. B. „Objekt geschlossen").';
