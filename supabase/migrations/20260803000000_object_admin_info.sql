-- =============================================================
-- Thiel Dienstleistungen – Admin-Info am Objekt (Foto-Import Items)
-- =============================================================
-- Änderungen:
--   1. objects.customer          (Kunde / Ansprechpartner)
--   2. objects.customer_number   (Kundennummer)
--   3. objects.cleaning_interval (Reinigungsturnus)
--
-- Diese Felder werden beim Foto-Import (Items) per KI erkannt und
-- gespeichert und sind nur für Admins sichtbar (die API liefert sie
-- für Nicht-Admins nicht aus).
-- =============================================================

alter table public.objects
  add column customer text;

alter table public.objects
  add column customer_number text;

alter table public.objects
  add column cleaning_interval text;

comment on column public.objects.customer is
  'Kunde (Firma/Ansprechpartner) – nur für Admins sichtbar.';
comment on column public.objects.customer_number is
  'Kundennummer – nur für Admins sichtbar.';
comment on column public.objects.cleaning_interval is
  'Reinigungsturnus (z. B. wöchentlich) – nur für Admins sichtbar.';
