# Tourenplanung – THIEL, RAW_DE und RAW_EN

Ein Repository, drei eigenständige Next.js-Projekte mit demselben Funktionsumfang:

| Ordner | Inhalt |
| :--- | :--- |
| [`THIEL/`](THIEL) | Der produktive Stand für Thiel Dienstleistungen – unverändert. |
| [`RAW_DE/`](RAW_DE) | Derselbe Code ohne Firmenbezug: neutrale Platzhalter, alle Firmen- und Regionswerte über Umgebungsvariablen, deutsche Oberfläche. Vorlage für weitere Firmen. |
| [`RAW_EN/`](RAW_EN) | Wie `RAW_DE`, aber vollständig englische Oberfläche (Texte, Datums-/Zahlenformate, OCR-Prompts, Doku). Unterscheidet sich nur sprachlich. |

Alle Ordner sind vollständig lauffähig (`npm ci`, `.env.local` anlegen,
`npm run dev`). Details zur Anpassung stehen in [`RAW_DE/README.md`](RAW_DE/README.md)
bzw. [`RAW_EN/README.md`](RAW_EN/README.md), die Systembeschreibung der Thiel-App
in [`THIEL/SPEC.md`](THIEL/SPEC.md).

`THIEL/` ist die führende Codebasis: Funktionale Änderungen werden dort gemacht
und anschließend nach `RAW_DE/` und `RAW_EN/` übertragen, ohne dort die
Firmenwerte zu überschreiben bzw. die englischen Texte zurückzudrehen.
