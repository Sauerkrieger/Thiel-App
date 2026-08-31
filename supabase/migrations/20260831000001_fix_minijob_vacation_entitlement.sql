-- =============================================================
-- Thiel Dienstleistungen – Minijob-Urlaubsanspruch korrigieren
-- Migration 20260831000001
--
-- Bestehende Minijob-Profile tragen teils noch den alten Spalten-Default
-- 30 als Jahresurlaub (`vacation_days_per_year`), obwohl der Minijob-Default
-- 12 Tage beträgt (siehe CONTRACT_DEFAULTS bzw. handle_new_user-Trigger).
-- Die Resturlaub-Anzeige rechnet direkt aus diesem Wert, daher zeigen solche
-- Profile zu Unrecht 30 (für 2 Arbeitstage/Woche) statt 12 Tage.
--
-- Korrigiert werden NUR Profile, bei denen noch der falsche Default (30)
-- gespeichert ist. Manuell angepasste Werte bleiben unverändert.
-- =============================================================

update public.profiles
   set vacation_days_per_year = 12
 where contract_type = 'mini_job'
   and vacation_days_per_year = 30;