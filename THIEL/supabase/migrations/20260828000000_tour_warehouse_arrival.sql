-- =============================================================
-- Thiel Dienstleistungen – Tour: geplante Ankunft im Lager
-- Migration 20260828000000
-- =============================================================
-- Beim Start der Tour („Ausfahren beginnen“) wird neben den Ankunftszeiten
-- der Stopps auch die geplante Rückkehr/Ankunft im Lager gespeichert, damit
-- die Tourseite den Lager-Eintrag wie einen normalen Stopp mit Zeit und
-- Navigation anzeigen kann.

alter table public.active_tours
  add column if not exists warehouse_arrival time;

comment on column public.active_tours.warehouse_arrival is
  'Geplante Ankunftszeit zurück im Lager (HH:MM), beim Tourstart aus der Routenberechnung übernommen.';
