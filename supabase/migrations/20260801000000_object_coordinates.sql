-- =============================================================
-- Thiel Dienstleistungen – Adress-Verifizierung
-- Migration: latitude/longitude für public.objects
--
-- Speichert die per OpenRouteService-Geocoding verifizierten
-- Koordinaten einer Adresse. NULL = Adresse (noch) nicht verifiziert.
-- =============================================================

alter table public.objects
  add column latitude double precision,
  add column longitude double precision;

comment on column public.objects.latitude is
  'Breitengrad der verifizierten Adresse (ORS-Geocoding). NULL = nicht verifiziert.';
comment on column public.objects.longitude is
  'Längengrad der verifizierten Adresse (ORS-Geocoding). NULL = nicht verifiziert.';
