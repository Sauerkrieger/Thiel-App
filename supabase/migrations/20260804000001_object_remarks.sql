-- =============================================================
-- Thiel Dienstleistungen – Objekt-Bemerkung
-- =============================================================
-- Änderungen:
--   1. objects.remark (Bemerkung zum Objekt)
--
-- Die Bemerkung ist für alle Rollen sichtbar (Fahrer, Admin, ...),
-- bearbeitet werden kann sie nur von Admins (die API-Routen für
-- Objekte sind ohnehin admin-only).
-- =============================================================

alter table public.objects
  add column remark text;

comment on column public.objects.remark is
  'Bemerkung zum Objekt (für alle sichtbar, z. B. Zugangshinweise). Nur Admins können sie bearbeiten.';
