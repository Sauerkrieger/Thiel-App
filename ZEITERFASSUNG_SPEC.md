# Thiel Dienstleistungen – Implementierungsplan: Zeiterfassung & Urlaubsverwaltung

## 🛠️ Architektur & Design-Entscheidungen (Bestehende Offline-Infrastruktur)
- **Rollenübergreifend & Admin-Übersicht:** Skalierbare Tabellen für alle Mitarbeiter (Fahrer, Springer, Reiniger, Objektbetreuer, Admins) mit Filter nach Rolle/Status, Freigabe-Feed und Lohn-CSV-Export.
- **Offline-First Stempeluhr via IndexedDB & LWW:** Stempel-Events werden über die bestehende `src/lib/offline/db.ts` in IndexedDB gespeichert (`pending_upload`). Mit `nowServerAligned()` aus `src/lib/offline/clock.ts` werden `client_updated_at`-Zeitstempel gesetzt. Der Sync läuft nahtlos über die bestehende Sync-Engine (`src/lib/offline/sync.ts` & `/api/sync`).
- **Nahtlose Integration:** Subtiler Stempel-Live-Badge im Header der AppShell (`🟢 04:12 h`).

## 📋 Schritt-für-Schritt Checkliste
### Phase 1: Datenbank, Sync-Integration & Backend API (Schritt 1)
- [x] Supabase Migration `20260806000001_time_tracking.sql` erstellen (Schema, LWW-Spalten `client_updated_at`/`synced_at`, RLS)
- [x] TypeScript Typen in `src/types/time-tracking.ts` definieren
- [x] Integration in Sync-Tabellen (`src/lib/sync-tables.ts` & `src/lib/lww.ts`) für `time_entries` & `time_off_requests`
- [x] API-Route `POST/GET /api/time-tracking/clock` (Stempel-Status & Aktionen)

### Phase 2: Offline Stempeluhr & Header-Integration (Schritt 2)
- [x] UI-Komponente `ClockWidget` (Stempeluhr mit Live-Timer, Pausen-Toggle)
- [x] Einbindung von `offlineFetch` für Stempel-Aktionen und Offline-Read aus IndexedDB
- [x] Header-Integration in `AppShell` (`🟢 04:12 h`)
- [ ] Tour-Koppler: Optionales automatisches Einstechen bei "Ausfahren beginnen" (bewusst optional)

### Phase 3: Mitarbeiter-Dashboard (`/zeiterfassung`) (Schritt 3)
- [x] Wochen- & Monatsübersicht gestempelter Zeiten (mittels `offlineFetch` aus IndexedDB/Cache)
- [x] Formular für Urlaubs- & Krankheitsanträge
- [x] Anzeige Resturlaub & Überstundenkonto

### Phase 4: Admin-Zentrale (`/admin/zeiterfassung`) (Schritt 4)
- [x] Mitarbeiter-Status-Grid (aktiver Stempelstatus, Tour und nächstes Objekt sowie Konten)
- [x] Freigabe-Feed für Urlaubsanträge & Stundennachträge
- [x] CSV-Export für Lohnbuchhaltung
- [x] Rollen- & Suchfilter

### Abschluss-Ergänzungen
- [x] Offline-Queue und Cache-Assemler für Dashboard, Stempeluhr und Admin-Übersicht
- [x] Urlaubskonto-Buchung bei Genehmigung/Widerruf per Datenbanktrigger
- [x] Mitarbeiter- und Admin-Routen serverseitig geschützt
- [x] Bestehende Tour-/Objekt-Kopplung bleibt optional und unverändert
