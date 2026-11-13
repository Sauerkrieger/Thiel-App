import re, pathlib
BASE = pathlib.Path("RAW_EN/src")
R = {
 "components/settings/settings-page.tsx": [
   ("Abmelden", "Sign out"),
   ("Benutzerverwaltung", "User management"),
   ("<Label>Vertragsart</Label>", "<Label>Contract type</Label>"),
   ("Jahresurlaub – in allen Vertragsarten manuell anpassbar.",
    "Annual vacation – adjustable manually for every contract type."),
   ("selected – the cleaner only sees diese Objekte.", "selected – the cleaner only sees these objects."),
   ("Benutzer anlegen", "Create user"),
   ("(Reinigungskraft) sieht nur die hier zugewiesenen Objekte – mindestens eines ist Pflicht.",
    "(cleaner) only sees the objects assigned here – at least one is required."),
 ],
 "components/planning/pack-dialog.tsx": [(">Fertig<", ">Done<"), ("\n            Fertig\n", "\n            Done\n")],
 "components/planning/planning-page.tsx": [("Keine Objekte gefunden, die zu „{search}“ passen.", "No objects match “{search}”.")],
 "components/objects/objects-page.tsx": [("Keine Objekte gefunden, die zu „{search}“ passen.", "No objects match “{search}”.")],
}
def flex(p):
    return re.compile(r"\s+".join(re.escape(w) for w in p.split()))
for rel, pairs in R.items():
    p = BASE / rel
    t = p.read_text(encoding="utf-8"); n = 0
    for old, new in pairs:
        t, k = flex(old).subn(lambda m: new, t); n += k
    p.write_text(t, encoding="utf-8"); print(rel, n)
