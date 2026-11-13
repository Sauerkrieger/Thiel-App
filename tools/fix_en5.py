import re, pathlib
BASE = pathlib.Path("RAW_EN/src")
R = {
 "components/objects/objects-page.tsx": [("Nr. {obj.key_number}", "No. {obj.key_number}"), ("Foto-Import", "Photo import"), ("Standard-Items.", "standard items."), ("Kategorie", "Category")],
 "components/objects/items-dialog.tsx": [("Nr. {object.key_number}", "No. {object.key_number}"), ("Foto hochgeladen.", "Photo uploaded."), ("Foto entfernen", "Remove photo")],
 "components/objects/object-form-dialog.tsx": [("Foto hochgeladen.", "Photo uploaded."), ("Foto entfernen", "Remove photo"), ("Opens at (Uhrzeit)", "Opens at (time)")],
 "components/objects/object-info-dialog.tsx": [("Nr. {object.key_number}", "No. {object.key_number}")],
 "components/objects/photo-import-dialog.tsx": [("? ` (Nr. ${obj.key_number})`", "? ` (No. ${obj.key_number})`"), ("Foto-Import (KI)", "Photo import (AI)"), ("Kunde (nur Admin)", "Customer (admin only)"), ("Als Standard-Item markieren", "Mark as standard item")],
 "components/planning/key-selection-dialog.tsx": [("Nr. {stop.key_number}", "No. {stop.key_number}")],
 "components/planning/pack-view.tsx": [("Nr. {stop.key_number}", "No. {stop.key_number}")],
 "components/tour/tour-page.tsx": [("Nr. {stop.key_number}", "No. {stop.key_number}")],
 "components/planning/planning-page.tsx": [("Foto-Auswahl", "Photo import")],
 "components/planning/pack-dialog.tsx": [("Anzahl", "Qty"), ("Stück", "pcs")],
 "components/tour/delivery-dialog.tsx": [("Anzahl", "Qty")],
 "components/chat/chat-page.tsx": [("Foto aufnehmen", "Take photo")],
 "components/history/history-page.tsx": [("nr. ${key}", "no. ${key}")],
 "components/time-tracking/admin-time-tracking-page.tsx": [
   ("Schichtdetails (CSV)", "Shift details (CSV)"),
   ("Ausstempeln &amp; freigeben", "Clock out &amp; approve"),
   ("Minijob-Limit fast erreicht", "Mini-job limit almost reached"),
   ("Lohnexport_${COMPANY_SLUG}_", "payroll_export_${COMPANY_SLUG}_"),
   ("\"Monatsuebersicht\" : \"Schichtdetails\"", "\"monthly_overview\" : \"shift_details\""),
   ("Einstempeln vom ${new Date(closingEntry.clock_in).toLocaleDateString(\"en-GB\")} um ${timeLabel(closingEntry.clock_in)} – still open",
    "Clock-in on ${new Date(closingEntry.clock_in).toLocaleDateString(\"en-GB\")} at ${timeLabel(closingEntry.clock_in)} – still open"),
 ],
 "app/api/admin/time-tracking/entries/[id]/route.ts": [("Ausstempeln (Korrektur)", "Clock-out (correction)")],
 "app/api/admin/time-tracking/export/route.ts": [("Lohnexport_${COMPANY_SLUG}_Schichtdetails_", "payroll_export_${COMPANY_SLUG}_shift_details_")],
 "lib/image-upload.ts": [("\"kamera-foto\"", "\"camera-photo\"")],
}
def flex(p):
    return re.compile(r"\s+".join(re.escape(w) for w in p.split()))
total = 0
for rel, pairs in R.items():
    p = BASE / rel
    if not p.exists(): print("FEHLT", rel); continue
    t = p.read_text(encoding="utf-8"); n = 0
    for old, new in pairs:
        t, k = flex(old).subn(lambda m: new, t); n += k
    p.write_text(t, encoding="utf-8"); total += n
    print(f"  {rel}: {n}")
print("ERSETZUNGEN:", total)
