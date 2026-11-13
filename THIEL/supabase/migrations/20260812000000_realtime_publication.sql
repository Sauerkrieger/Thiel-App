-- =============================================================
-- Thiel Dienstleistungen – Realtime: Publication für postgres_changes
-- Migration 20260812000000
--
-- Supabase Realtime (postgres_changes) liefert nur dann Events,
-- wenn die betroffene Tabelle in der `supabase_realtime`-Publication
-- enthalten ist. Ohne das kommen keine Push-Updates an – die Seiten
-- aktualisieren sich erst nach einem manuellen F5.
--
-- Hier werden die Tabellen aufgenommen, auf die die Admin-Seiten
-- per useRealtimeRefresh() subscriben:
--   * profiles            (Status/Rolle/Name der Mitarbeiter)
--   * time_entries        (Einstempeln/Ausstempeln -> "Aktiv"/"Nicht aktiv")
--   * time_off_requests   (neue Anträge / Statuswechsel)
--   * active_tours        (Tourenstart/-abschluss für die Historie)
--
-- Idempotent: bereits enthaltene Tabellen werden übersprungen
-- (SQLSTATE 42710 duplicate_object), falls sie z. B. schon manuell
-- im Dashboard hinzugefügt wurden.
-- =============================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles',
    'time_entries',
    'time_off_requests',
    'active_tours'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      -- Tabelle ist bereits Mitglied der Publication – kein Fehler.
      null;
    end;
  end loop;
end
$$;
