#!/usr/bin/env python3
"""RAW_EN: Label-Konstanten, Formatierung und Doku auf Englisch."""
import pathlib
import sys

GLOBAL = [
    ('"de-DE"', '"en-GB"'),
    ("de-DE", "en-GB"),
    ('facility_manager: "Reinigungskraft"', 'facility_manager: "Cleaner"'),
    ('substitute: "Springer"', 'substitute: "Substitute"'),
    ('full_time: "Vollzeit"', 'full_time: "Full time"'),
    ('part_time: "Teilzeit"', 'part_time: "Part time"'),
    ('mini_job: "Minijob"', 'mini_job: "Mini job"'),
    ('sick_leave: "Krankheit"', 'sick_leave: "Sick leave"'),
    ('sick_leave: "Krankmeldung"', 'sick_leave: "Sick leave"'),
    ('unpaid: "Unbezahlte Abwesenheit"', 'unpaid: "Unpaid leave"'),
    ('unpaid: "Unbezahlt"', 'unpaid: "Unpaid leave"'),
    ('compensatory: "Freizeitausgleich"', 'compensatory: "Time off in lieu"'),
    ('substitute: "Vertretung"', 'substitute: "Substitution"'),
    ('packing: "Packen"', 'packing: "Packing"'),
    ('in_transit: "Unterwegs"', 'in_transit: "In transit"'),
    ('completed: "Abgeschlossen"', 'completed: "Completed"'),
    ('return `${h} Std. ${m} min.`', 'return `${h} h ${m} min.`'),
    ('return `${h} Std.`', 'return `${h} h`'),
    ("`Nr. ", "`No. "),
    ("Nr. ${key}", "No. ${key}"),
    ('"Datum"', '"Date"'),
    ('"Wochentag"', '"Weekday"'),
    ('"Personalnummer"', '"Personnel number"'),
    ('"Nachname"', '"Last name"'),
    ('"Vorname"', '"First name"'),
    ('"Rolle"', '"Role"'),
    ('"Einsatzort_Objekt"', '"Work location object"'),
    ('"Schichttyp"', '"Shift type"'),
    ('"Von"', '"From"'),
    ('"Bis"', '"To"'),
    ('"Pause_Minuten"', '"Break minutes"'),
    ('"Arbeitszeit_Stunden"', '"Work hours"'),
    ('"Freigegeben_Von"', '"Approved by"'),
    ('"Bemerkung"', '"Note"'),
    ("h/Woche", "h/week"),
    ("Tage/Woche", "days/week"),
    ("Tage/Jahr", "days/year"),
    ("/Woche", "/week"),
]

DEPLOY_NOTE = """## Deployment auf Freebuff Sites (Cloudflare Workers)

This folder is prepared for the Sites adapter (Next.js + OpenNext, `freebuff.wrangler.jsonc`). Two things to note:

- `NEXT_PUBLIC_*` values are compiled into the code at **build** time. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the `NEXT_PUBLIC_COMPANY_*` / `NEXT_PUBLIC_SERVICE_*` values must therefore be set before the build — changing them later requires a new build.
- Non-public values (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `ORS_API_KEY`, `VAPID_*`, …) are read at runtime from the Worker environment and can be stored as Sites secrets.
- Database: run `supabase/setup.sql` once in the Supabase SQL editor (contains all migrations in order).
"""


def main() -> None:
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    for p in root.rglob("*"):
        if p.suffix not in {".ts", ".tsx"} or "node_modules" in p.parts:
            continue
        text = p.read_text(encoding="utf-8")
        new = text
        for old, rep in GLOBAL:
            new = new.replace(old, rep)
        if new != text:
            p.write_text(new, encoding="utf-8")

    readme = root / "README.md"
    if readme.exists():
        text = readme.read_text(encoding="utf-8")
        start = text.find("## Deployment auf Freebuff Sites")
        if start != -1:
            end = text.find("## Aufbau")
            text = text[:start] + DEPLOY_NOTE + "\n" + text[end:]
        readme.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
