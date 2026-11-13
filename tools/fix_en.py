#!/usr/bin/env python3
"""Gezielte Korrekturen für RAW_EN (Mischformen + letzte UI-Texte + Locale)."""
import pathlib
import sys

FIXES = [
    ("src/components/history/history-page.tsx", [
        ('? `Für „${filteredLabel}” yet.`', '? `No tours for “${filteredLabel}” yet.`'),
        ('aria-label={`Tour of ${new Date(tour.date + "T00:00:00").toLocaleDateString("de-DE")} löschen`}',
         'aria-label={`Delete tour of ${new Date(tour.date + "T00:00:00").toLocaleDateString("en-GB")}`}'),
        ('>Schlüssel mitgenommen: ', '>Keys taken: '),
        ('<p className="text-xs text-muted-foreground">Schlüssel mitgenommen: ',
         '<p className="text-xs text-muted-foreground">Keys taken: '),
    ]),
    ("src/components/inventory/inventory-page.tsx", [
        ('aria-label={`${item.name} löschen`}', 'aria-label={`Delete ${item.name}`}'),
        ('aria-label={`${item.item_name} löschen`}', 'aria-label={`Delete ${item.item_name}`}'),
    ]),
    ("src/components/objects/items-dialog.tsx", [
        ('aria-label={`${item.item_name} löschen`}', 'aria-label={`Delete ${item.item_name}`}'),
    ]),
    ("src/components/settings/settings-page.tsx", [
        ('toast.success(`Nutzer „${deleteTarget.name}“ gelöscht.`);',
         'toast.success(`User “${deleteTarget.name}” deleted.`);'),
        ('aria-label={`${u.name} löschen`}', 'aria-label={`Delete ${u.name}`}'),
    ]),
    ("src/components/tour/navigate-button.tsx", [
        ('`Google Maps for ${label} öffnen`', '`Open Google Maps for ${label}`'),
    ]),
    ("src/components/tour/delivery-dialog.tsx", [
        ('Für dieses Objekt sind keine Items hinterlegt.', 'No items stored for this object yet.'),
    ]),
    ("src/components/setup-hint.tsx", [
        ('<li>Führe die Migrationen mit `supabase db push` aus</li>',
         '<li>Run the migrations with `supabase db push`</li>'),
    ]),
    ("src/lib/address.ts", [
        ('`Ort fehlt – die Adresse wird als „${SERVICE_CITY}“ übernommen. Bitte Ort ergänzen (e.g. „12345 ${SERVICE_CITY}“).`',
         '`City missing – the address is assumed to be “${SERVICE_CITY}”. Please add the city (e.g. “12345 ${SERVICE_CITY}”).`'),
        ('"Ort fehlt – bitte Ortsangabe ergänzen (e.g. „12 Main Street, 12345 Stadt“)."',
         '"City missing – please add the city (e.g. “12 Main Street, 12345 Town”)."'),
        ('message: `Nur ${SERVICE_CITY} zulässig – außer die Stadt stand explizit im Foto (erkannt: „${info.city}“).`',
         'message: `Only ${SERVICE_CITY} allowed – unless the city was stated explicitly on the photo (detected: “${info.city}”).`'),
    ]),
    ("src/components/objects/photo-import-dialog.tsx", [
        ('description: "Schlüsselliste mit Objektnamen – Nummern zuordnen."',
         'description: "Key list with object names – assign numbers."'),
        ('description: "Packliste mit Objektangaben – nur neue Objekte anlegen und ähnliche bestehende Objekte warnen."',
         'description: "Packing list with object details – only create new objects and warn about similar existing ones."'),
        ('`${skippedNew} neue${skippedNew === 1 ? "s" : ""} Objekt${skippedNew === 1 ? "" : "e"} übersprungen – exakte Adresse (mit Hausnummer) fehlt.`',
         '`${skippedNew} new object${skippedNew === 1 ? "" : "s"} skipped – exact address (with house number) is missing.`'),
        ('toast.success(`objekte hinzu gefügt ${newObjects.length}`);',
         'toast.success(`objects added: ${newObjects.length}`);'),
        ('return "Fotografiere eine Schlüsselliste mit Objektnamen und -nummern. Die KI ordnet die Nummern bestehenden Objekten zu – du kannst die Zuordnung in der Vorschau anpassen. Schlüssel ohne passendes Objekt werden nicht übernommen. Du bestätigst vor dem Speichern.";',
         'return "Photograph a key list with object names and numbers. The AI matches the numbers to existing objects – you can adjust the assignment in the preview. Keys without a matching object are not applied. You confirm before saving.";'),
        ('return "Fotografiere eine Packliste mit Objektname (oft mit Adresse oder Ort), Kunde/Kundennummer/Reinigungsturnus und Items. Jede erkannte Gruppe wird als neues Objekt angelegt; ähnliche bestehende Objekte werden nur gewarnt. Du bestätigst vor dem Speichern.";',
         'return "Photograph a packing list with object name (often with address or town), customer/customer number/cleaning interval and items. Each detected group is created as a new object; similar existing objects only trigger a warning. You confirm before saving.";'),
        ('return "Fotografiere eine Liste – die KI erkennt die Einträge, du bestätigst vor dem Speichern.";',
         'return "Photograph a list – the AI detects the entries, you confirm before saving.";'),
        ('aria-label={`Schlüssel-Nummer für ${k.object_name}`}', 'aria-label={`Key number for ${k.object_name}`}'),
        ('aria-label={`${g.object_name}: Gruppe übernehmen`}', 'aria-label={`${g.object_name}: apply group`}'),
        ('aria-label={`Kunde für ${g.object_name}`}', 'aria-label={`Customer for ${g.object_name}`}'),
        ('aria-label={`Kundennummer für ${g.object_name}`}', 'aria-label={`Customer number for ${g.object_name}`}'),
        ('aria-label={`Reinigungsturnus für ${g.object_name}`}', 'aria-label={`Cleaning interval for ${g.object_name}`}'),
    ]),
    ("src/components/planning/pack-view.tsx", [
        ('? `Schlüssel: ${sortedKeys.map((key) => `Nr. ${key}`).join(", ")}`',
         '? `Keys: ${sortedKeys.map((key) => `no. ${key}`).join(", ")}`'),
    ]),
    ("src/components/time-tracking/admin-time-tracking-page.tsx", [
        ('const title = `${last.change_reason ?? "Geändert"} by ${last.changed_by_name ?? "unbekannt"} on ${formatAuditDate(last.changed_at)}`;',
         'const title = `${last.change_reason ?? "Changed"} by ${last.changed_by_name ?? "unknown"} on ${formatAuditDate(last.changed_at)}`;'),
        ('Forgotten clock-outs – offene Stempelungen, die automatisch markiert wurden (12 h überschritten oder Mitternacht erreicht). Die Dauer zählt live mit.',
         'Forgotten clock-outs – open clock-ins that were flagged automatically (12 h exceeded or midnight reached). The duration counts live.'),
        ('Keine offenen Prüfbedarf-Einträge für ${selectedEmployeeName ?? "die gewählte Person"}.',
         'No pending review entries for ${selectedEmployeeName ?? "the selected person"}.'),
        ('Keine offenen Freigaben für ${selectedEmployeeName ?? "die gewählte Person"}.',
         'No pending approvals for ${selectedEmployeeName ?? "the selected person"}.'),
        ('· Remaining vacation ${vacationRemainingOf(selectedEmployee)} Tage ·',
         '· Remaining vacation ${vacationRemainingOf(selectedEmployee)} days ·'),
        ('läuft seit ${liveDurationLabel(entry, now)}', 'running since ${liveDurationLabel(entry, now)}'),
        ('Notiz: ${entry.note}', 'Note: ${entry.note}'),
        ('Ausstempeln &amp; Freigeben', 'Clock out &amp; approve'),
        ('Eintrag bearbeiten', 'Edit entry'),
        ('Eintrag löschen', 'Delete entry'),
        ('Ausstehend', 'Pending'),
        ('Nachgereichte Arbeitszeit ·', 'Submitted work time ·'),
        ('Vergessene Ausstempelung ·', 'Forgotten clock-out ·'),
        ('Pause ${entry.break_duration_minutes} Min.', 'Break ${entry.break_duration_minutes} min.'),
        ('"läuft gerade"', '"running"'),
        ('"offen"', '"open"'),
        ('"Keine offenen Freigaben."', '"No pending approvals."'),
        ('"Keine offenen Prüfbedarf-Einträge."', '"No pending review entries."'),
        ('Keine Stempelungen vorhanden.', 'No clock-ins yet.'),
        ('Notiz / Begründung', 'Note / reason'),
        ('Freigabe-Feed', 'Approval feed'),
        ('Nachgereichte Arbeitszeiten und Anträge prüfen.', 'Review submitted work times and requests.'),
        ('Stempel-Eintrag löschen?', 'Delete clock entry?'),
        ('Änderungshistorie', 'Change history'),
        ('Keine Änderungen protokolliert.', 'No changes recorded.'),
    ]),
]

DOC_FIX = [
    ("src/app/layout.tsx", [('<html lang="de"', '<html lang="en"')]),
]


def main() -> None:
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    missing = 0
    for rel, pairs in FIXES + DOC_FIX:
        p = root / rel
        text = p.read_text(encoding="utf-8")
        for old, new in pairs:
            if old not in text:
                print(f"NICHT GEFUNDEN in {rel}: {old[:80]!r}")
                missing += 1
                continue
            text = text.replace(old, new)
        p.write_text(text, encoding="utf-8")
    print(f"Fertig, {missing} nicht gefundene Stellen")


if __name__ == "__main__":
    main()
