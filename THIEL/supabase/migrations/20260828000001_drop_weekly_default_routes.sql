-- =============================================================
-- Thiel Dienstleistungen – Wochentags-Vorauswahl entfernt
-- Migration 20260828000001
-- =============================================================
-- Das Speichern von Zielen vor dem Packen (automatische Vorauswahl an
-- bestimmten Wochentagen) wurde aus der App entfernt. Die zugehörige
-- Tabelle und der RPC werden daher gelöscht.

drop function if exists public.save_weekly_defaults(uuid, integer, uuid[]);
drop function if exists public.save_weekly_defaults(integer, uuid[]);

drop table if exists public.weekly_default_routes;
