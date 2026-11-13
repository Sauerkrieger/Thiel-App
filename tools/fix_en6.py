#!/usr/bin/env python3
"""RAW_EN: restliche deutsche Strings (Meldungen, Logs, Fehlertexte)."""
import pathlib
import sys

PAIRS = [
    # --- API / Auth
    ('"Login fehlgeschlagen."', '"Login failed."'),
    ('`Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`',
     '`The new password must be at least ${MIN_PASSWORD_LENGTH} characters long.`'),
    ('`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`',
     '`The password must be at least ${MIN_PASSWORD_LENGTH} characters long.`'),
    ('"Foto-Import fehlgeschlagen"', '"Photo import failed"'),
    ('"[Geometry] ORS-Directions fehlgeschlagen (Status ${res.status}):"',
     '"[Geometry] ORS directions failed (status ${res.status}):"'),
    ('"ORS-Routenberechnung fehlgeschlagen."', '"ORS route calculation failed."'),
    ('"[Geometry] ORS-Antwort ohne Geometrie:"', '"[Geometry] ORS response without geometry:"'),
    ('"[SW] Registrierung fehlgeschlagen:"', '"[SW] Registration failed:"'),
    # --- Chat
    ('"Preferred language gespeichert."', '"Preferred language saved."'),
    ('"Sichtbare Auswahl aufheben"', '"Clear visible selection"'),
    ('" Bild wird geladen…"', '" Loading image…"'),
    # --- Objekte / Items
    ('"Bezeichnung (e.g. Micromops)"', '"Name (e.g. Micromops)"'),
    ('"Bezeichnung neues Item"', '"Name for new item"'),
    ('"Bezeichnung Item ${ii + 1}"', '"Name of item ${ii + 1}"'),
    ('>Bezeichnung<', '>Name<'),
    ('"Standard-Item (immer mitnehmen)"', '"Default item (always include)"'),
    ('"KI-Import fehlgeschlagen."', '"AI import failed."'),
    # --- Planung / Tour
    ('"Packliste konnte nicht geladen werden."', '"Could not load the packing list."'),
    ('"Item-Foto Vorschau"', '"Item photo preview"'),
    ('"Optimierung fehlgeschlagen"', '"Optimisation failed"'),
    ('"Analyse fehlgeschlagen."', '"Analysis failed."'),
    ('"Routenberechnung fehlgeschlagen."', '"Route calculation failed."'),
    ('"Ausfahren beginnen"', '"Start the tour"'),
    ('>Lager<', '>Warehouse<'),
    ('" als beliefert markieren"', '" mark as delivered"'),
    ('"Als beliefert markieren"', '"Mark as delivered"'),
    ('als beliefert markiert.', 'marked as delivered.'),
    ('wieder als offen markiert.', 'marked as open again.'),
    # --- Zeiterfassung
    ('"Einstempeln fehlgeschlagen."', '"Clock-in failed."'),
    ('"Ausstempeln fehlgeschlagen."', '"Clock-out failed."'),
    ('"Erst einstempeln"', '"Clock in first"'),
    ('"Ausstempeln vergessen"', '"Forgot to clock out"'),
    ('"Nur ausstempeln"', '"Clock out only"'),
    ('"Lohnexport fehlgeschlagen."', '"Payroll export failed."'),
    ('"Nachreichen fehlgeschlagen."', '"Submission failed."'),
    ('"e.g. vergessen auszustempeln"', '"e.g. forgot to clock out"'),
    ('"e.g. vergessen einzustempeln"', '"e.g. forgot to clock in"'),
    ('" Daten werden geladen…"', '" Loading data…"'),
    ('"Noch keine Stempelungen vorhanden."', '"No clock-ins yet."'),
    # --- Einstellungen
    ('"Passkey-Registrierung fehlgeschlagen."', '"Passkey registration failed."'),
    ('"Profil gespeichert."', '"Profile saved."'),
    ('"Objektzuweisung gespeichert."', '"Object assignment saved."'),
    ('"Vertrag gespeichert."', '"Contract saved."'),
    ('Angemeldet als <span', 'Signed in as <span'),
    # --- Sync / Logs
    ('"Sync fehlgeschlagen (HTTP ${res.status})."', '"Sync failed (HTTP ${res.status})."'),
    ('"Sync fehlgeschlagen."', '"Sync failed."'),
    ('"[Realtime] KEINE Session im Browser-Client – Events werden durch RLS gefiltert!"',
     '"[Realtime] No session in the browser client – events are filtered by RLS!"'),
    ('"[Realtime] Konnte nicht geladen werden:"', '"[Realtime] Could not be loaded:"'),
    ('"[ORS] Optimization fehlgeschlagen (Status ${res.status}):"',
     '"[ORS] Optimization failed (status ${res.status}):"'),
    ('"[ORS] Optimization-Anfrage fehlgeschlagen:"', '"[ORS] Optimization request failed:"'),
    ('"[ORS] Matrix-Antwort unerwartet – durations fehlt oder passt nicht zur Anfrage:"',
     '"[ORS] Unexpected matrix response – durations missing or not matching the request:"'),
    ('"[ORS] Matrix-Anfrage fehlgeschlagen:"', '"[ORS] Matrix request failed:"'),
    ('"[Optimizer] Koordinaten-Backfill fehlgeschlagen:"', '"[Optimizer] Coordinate backfill failed:"'),
    ('"[Optimizer] Persistierung der Koordinaten fehlgeschlagen:"', '"[Optimizer] Saving coordinates failed:"'),
    ('"[Optimizer] Persistierung frisch geocodeter Koordinaten fehlgeschlagen:"',
     '"[Optimizer] Saving freshly geocoded coordinates failed:"'),
    ('"Live-Verkehr fehlgeschlagen – Route ohne Live-Verkehr berechnet."',
     '"Live traffic failed – route calculated without live traffic."'),
    ('"[Stadia] Matrix-Anfrage fehlgeschlagen (Status ${res.status}):"',
     '"[Stadia] Matrix request failed (status ${res.status}):"'),
    ('"[Stadia] Matrix-Antwort unerwartet – sources_to_targets fehlt oder passt nicht."',
     '"[Stadia] Unexpected matrix response – sources_to_targets missing or not matching."'),
    ('"[Stadia] Matrix-Anfrage fehlgeschlagen:"', '"[Stadia] Matrix request failed:"'),
    ('"[TomTom] Matrix-Antwort unerwartet (kein data-Array) – verwende Standard-Fahrzeiten."',
     '"[TomTom] Unexpected matrix response (no data array) – using default travel times."'),
    ('"[TomTom] Matrix-Anfrage fehlgeschlagen (Status ${res.status}):"',
     '"[TomTom] Matrix request failed (status ${res.status}):"'),
    ('"[TomTom] Fallback-Matrix fehlt oder passt nicht zur Anfrage – Zellen bleiben ohne Wert."',
     '"[TomTom] Fallback matrix missing or not matching the request – cells stay empty."'),
    ('"[TomTom] Matrix-Anfrage fehlgeschlagen:"', '"[TomTom] Matrix request failed:"'),
]


def main() -> None:
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    missing = []
    for p in root.rglob("*"):
        if p.suffix not in {".ts", ".tsx"} or "node_modules" in p.parts:
            continue
        text = p.read_text(encoding="utf-8")
        new = text
        for old, rep in PAIRS:
            if old not in new and old in text:
                continue
            new = new.replace(old, rep)
        if new != text:
            p.write_text(new, encoding="utf-8")
    # Kontrolle: welche Paare kamen nirgends vor?
    corpus = "\n".join(
        p.read_text(encoding="utf-8")
        for p in root.rglob("*.ts*")
        if "node_modules" not in p.parts
    )
    for old, rep in PAIRS:
        if rep not in corpus:
            missing.append(old)
    print("nicht angewandt:", len(missing))
    for m in missing:
        print("  -", m)


if __name__ == "__main__":
    main()
