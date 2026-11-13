import re, pathlib, sys
root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "RAW_EN/src")
WORDS = {"der","die","das","dem","den","des","und","oder","aber","mit","ohne","für","von","zu","zum","zur","auf","aus",
"bei","nach","vor","durch","gegen","ist","sind","war","wird","werden","wurde","hat","haben","nicht","kein","keine","keinen",
"alle","alles","bitte","dich","dir","du","dein","deine","deinem","deinen","ihr","ihre","ihren","unser","unsere","diese","dieser",
"dieses","einem","einen","eine","eines","noch","schon","wieder","immer","bereits","kann","muss","soll","darf","gibt","geht",
"hier","dort","jetzt","heute","gestern","morgen","uhr","objekt","objekte","tour","touren","fahrer","mitarbeiter","urlaub",
"krankheit","vertretung","pause","stunden","tage","woche","monat","jahr","lager","schlüssel","menge","anzahl","bezeichnung",
"bemerkung","adresse","straße","datum","zeit","ende","beginn","dauer","auswahl","anzeigen","löschen","speichern","abbrechen",
"hinzufügen","bearbeiten","anlegen","zuweisen","suchen","senden","laden","fehlt","ungültig","erforderlich","sonstiges",
"weitere","eintrag","einträge","zeitraum","aktuell","gesamt","summe","stück","personen","konto","passwort","kennwort",
"benutzer","anmelden","abmelden","anmeldung","melde","willkommen","aktiv","nicht","zuletzt","änder","geändert","gelöscht",
"angelegt","aktualisiert","gestartet","abgeschlossen","eingestempelt","ausgestempelt","wartet","freigabe","vertrittst",
"fährt","liefert","packen","abholen","übersicht","einstellungen","historie","geliefert","offen","geschlossen","hinweis",
"fehler","erfolgreich","foto","fotos","kategorie","kategorien","menge","bezeichnung","anzahl","hinweis","hinweise","bemerkung","bemerkungen","uhrzeit","übersicht","schlüssel","auftrag","lieferung","lieferungen","kunde","kunden","fahrer","fahrerin","fahrername","fahrzeug","benutzer","benutzerin","benutzername","benutzerliste","passwort","urlaub","urlaubsanspruch","urlaubstage","vertrag","vertragsart","minijob","stempel","stempelung","stempelungen","stempeluhr","stempelzeit","stempelhistorie","einstempeln","ausstempeln","nacherfassen","freigabe","freigaben","vertretung","vertretungen","vertretungskalender","krankheit","schicht","schichtbeginn","schichtdetails","woche","wochen","stück","packen","gepackt","standard-item","nr","foto-import","foto-analyse","foto-auswahl","foto-vorschau","kundenliste","gespeichert","kopiert","drucken","export","importieren","suchen","sortieren","aufsteigend","absteigend"}
SUFFIX = ("ung","keit","heit","lich","isch","ieren","iert")
def german(t):
    if not re.search(r"[A-Za-zÄÖÜäöüß]", t): return False
    if re.fullmatch(r"[\w./:%${}()\-\[\]\"'` +?=<>!&|*,]+", t.strip()) and " " not in t.strip(): return False
    words = re.findall(r"[A-Za-zÄÖÜäöüß]{2,}", t)
    sc = sum(1 for w in words if w.lower() in WORDS)
    if re.search(r"[äöüßÄÖÜ]", t) and any(w.lower().endswith(SUFFIX) or w.lower() in WORDS for w in words): return True
    if sc >= 1: return True
    if any(w.lower().endswith(("ung","keit","heit")) for w in words): return True
    return False
def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", lambda m: "\n"*m.group(0).count("\n"), src, flags=re.S)
    out = []
    for line in src.split("\n"):
        s = line.strip()
        out.append("" if s.startswith("//") else line)
    return "\n".join(out)
found = []
for p in sorted(root.rglob("*")):
    if p.suffix not in (".ts", ".tsx"): continue
    src = strip_comments(p.read_text(encoding="utf-8"))
    # JSX-Text (auch mehrzeilig) + String-Literale
    for m in re.finditer(r">\s*([^<>{}]{3,300}?)\s*<", src, re.S):
        t = " ".join(m.group(1).split())
        if t and german(t):
            found.append((p, src[:m.start()].count("\n")+1, t))
    for m in re.finditer(r'`([^`]{3,300})`|"([^"\n]{3,300})"', src):
        t = (m.group(1) if m.group(1) is not None else m.group(2))
        if german(t) and not t.strip().startswith(("M ", "m ", "/", "http", "%s")):
            found.append((p, src[:m.start()].count("\n")+1, " ".join(t.split())))
seen = set()
for p, ln, t in found:
    k = (str(p), t)
    if k in seen: continue
    seen.add(k)
    print(f"{p}:{ln} :: {t[:130]}")
print("KANDIDATEN:", len(seen))
