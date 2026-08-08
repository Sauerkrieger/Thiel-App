-- =============================================================
-- Thiel Dienstleistungen – Individuelle Verträge (custom)
-- Migration 20260810000000
--
-- Erweitert das Vertragsarten-Enum um 'custom' für benutzerdefinierte
-- Verträge mit eigenen Sollstunden, Arbeitstagen und Urlaubstagen.
--
-- Hinweis: Der Enum-Wert wird in einer eigenen Migration angelegt,
-- damit der ADD VALUE nicht in derselben Transaktion wie seine
-- Verwendung steht (Postgres: "unsafe use of new value of enum type").
-- =============================================================

alter type public.contract_type add value if not exists 'custom';
