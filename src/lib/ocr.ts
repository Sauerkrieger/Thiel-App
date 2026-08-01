import type { ObjectCategory } from "@/types/database";

/** Vom OCR erkanntes Objekt (noch nicht validiert). */
export type ExtractedObject = {
  name?: string | null;
  address: string;
  category?: ObjectCategory | null;
  is_pedestrian_zone_until_11?: boolean | null;
  opens_at?: string | null;
};

const SYSTEM_PROMPT = `Du bist ein präziser OCR-Assistent für eine Liefer- und Tourenplanungs-App. Ein Nutzer fotografiert eine gedruckte Adressliste (Lieferobjekte / Treppenhäuser). Extrahiere aus dem Bild alle Objekte als strukturiertes JSON.

Format-Antwort NUR als JSON-Objekt, ohne zusätzlichen Text:
{"objects": [{"name": "...", "address": "...", "category": "objekt|treppenhaus", "is_pedestrian_zone_until_11": false, "opens_at": "11:00"}]}

Regeln:
- "address": vollständige Adresse mit Straße und Hausnummer – Pflichtfeld.
- "name": Bezeichnung des Objekts, falls erkennbar (z. B. Firma/Kunde), sonst null.
- "category": nur "objekt" oder "treppenhaus"; Standard ist "objekt".
- "is_pedestrian_zone_until_11": true nur, wenn dies eindeutig erkennbar ist (z. B. Vermerk "Fußgängerzone", "nur bis 11 Uhr").
- "opens_at": nur wenn eine Uhrzeit erkennbar ist, sonst null (Format "HH:MM", z. B. "11:00").
- Fasse zusammengehörige Zeilen zu einem Eintrag zusammen (z. B. Name + Adresse in getrennten Zeilen).
- Ignoriere Überschriften, Seitennummern, Logos, Kopfteile und unlesbare Einträge.
- Falls das Bild keine brauchbare Liste enthält: {"objects":[]}`;

const USER_PROMPT =
  "Analysiere das folgende Foto einer gedruckten Adressliste und extrahiere alle Objekte als JSON.";

export class GeminiApiNotConfiguredError extends Error {
  constructor() {
    super(
      "GEMINI_API_KEY ist nicht konfiguriert. Für den Foto-Import bitte den API-Key in .env.local setzen.",
    );
    this.name = "GeminiApiNotConfiguredError";
  }
}

/** Gemini-Modell für die Bild-OCR (Alias = immer das aktuelle Flash-Lite im Free-Plan). */
const GEMINI_MODEL = "gemini-flash-lite-latest";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * Google Gemini Vision aufrufen (Modell gemini-flash-lite-latest) und den
 * reinen Text der Antwort zurückgeben. Wirft GeminiApiNotConfiguredError,
 * wenn GEMINI_API_KEY fehlt.
 */
async function callGeminiVision(
  systemPrompt: string,
  userPrompt: string,
  imageBase64: string,
  mimeType: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiApiNotConfiguredError();

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [
        {
          parts: [
            { text: userPrompt },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 4000,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let message = detail.slice(0, 300);
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string } };
      message = parsed.error?.message || message;
    } catch {
      // kein JSON – rohen Text verwenden
    }
    throw new Error(`Gemini-Fehler (${response.status}): ${message}`);
  }

  const json = await response.json().catch(() => null);
  const parts: { text?: string }[] =
    json?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part) => part.text ?? "").join("");
  if (!text.trim()) {
    throw new Error(
      "Gemini hat keine Antwort geliefert (möglicherweise vom Safety-Filter blockiert). Bitte ein anderes Foto versuchen.",
    );
  }
  return text;
}

/** Gemini (Vision) aufrufen und erkannte Objekte zurückgeben. */
export async function extractAddressesFromImage(
  imageBase64: string,
  mimeType: string,
): Promise<ExtractedObject[]> {
  const content = await callGeminiVision(
    SYSTEM_PROMPT,
    USER_PROMPT,
    imageBase64,
    mimeType,
  );
  return parseOcrResult(content);
}

/** JSON aus der Antwort extrahieren, validieren und bereinigen. */
export function parseOcrResult(content: string): ExtractedObject[] {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as {
      objects?: unknown;
    };
    if (!Array.isArray(parsed.objects)) return [];

    return parsed.objects
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null,
      )
      .map((entry) => ({
        name:
          typeof entry.name === "string" && entry.name.trim()
            ? entry.name.trim()
            : null,
        address:
          typeof entry.address === "string" ? entry.address.trim() : "",
        category: sanitizeCategory(entry.category),
        is_pedestrian_zone_until_11: Boolean(
          entry.is_pedestrian_zone_until_11,
        ),
        opens_at: sanitizeOpensAt(entry.opens_at),
      }))
      .filter((obj) => obj.address.length > 0);
  } catch {
    return [];
  }
}

function sanitizeCategory(value: unknown): ObjectCategory {
  if (typeof value === "string" && value.toLowerCase() === "treppenhaus") {
    return "treppenhaus";
  }
  return "objekt";
}

/** Nur plausible Uhrzeiten (HH:MM) durchlassen. */
function sanitizeOpensAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

/* ------------------------------------------------------------------ */
/* Packlisten-Erkennung (Foto → Items, Schritt 6)                      */
/* ------------------------------------------------------------------ */

/** Aus einem Foto erkanntes Item (Menge, Bezeichnung, Bemerkung). */
export type ExtractedItem = {
  item_name: string;
  quantity: number;
  note: string | null;
};

const ITEMS_SYSTEM_PROMPT = `Du bist ein präziser OCR-Assistent für eine Liefer- und Tourenplanungs-App. Ein Nutzer fotografiert eine Packliste / einen Zettel mit zu liefernden Gegenständen. Extrahiere alle Einträge als strukturiertes JSON.

Format-Antwort NUR als JSON-Objekt, ohne zusätzlichen Text:
{"items": [{"quantity": 60, "item_name": "Micromops", "note": "rot, gelb - kein blau"}]}

Regeln:
- "quantity": Menge als positive ganze Zahl, falls eine Zahl erkennbar ist (z. B. "60x" oder "60 Stück" -> 60), sonst 1.
- "item_name": Bezeichnung des Gegenstands – Pflichtfeld.
- "note": optionale Bemerkung (z. B. Farben, Varianten, Anmerkungen), sonst null.
- Fasse zusammengehörige Angaben (Menge + Bezeichnung + Bemerkung) zu einem Eintrag zusammen.
- Ignoriere Überschriften, Seitennummern, Logos und unlesbare Einträge.
- Falls das Bild keine brauchbare Packliste enthält: {"items":[]}`;

const ITEMS_USER_PROMPT =
  "Analysiere das folgende Foto einer Packliste und extrahiere alle Items als JSON.";

/** Gemini (Vision) aufrufen und erkannte Items zurückgeben. */
export async function extractItemsFromImage(
  imageBase64: string,
  mimeType: string,
): Promise<ExtractedItem[]> {
  const content = await callGeminiVision(
    ITEMS_SYSTEM_PROMPT,
    ITEMS_USER_PROMPT,
    imageBase64,
    mimeType,
  );
  return parseItemsResult(content);
}

/** JSON aus der Antwort extrahieren, validieren und bereinigen. */
export function parseItemsResult(content: string): ExtractedItem[] {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as {
      items?: unknown;
    };
    if (!Array.isArray(parsed.items)) return [];

    return parsed.items
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null,
      )
      .map((entry) => {
        const itemName =
          typeof entry.item_name === "string" ? entry.item_name.trim() : "";
        const quantity = Number(entry.quantity);
        return {
          item_name: itemName,
          quantity:
            Number.isInteger(quantity) && quantity > 0 ? quantity : 1,
          note:
            typeof entry.note === "string" && entry.note.trim()
              ? entry.note.trim().slice(0, 300)
              : null,
        };
      })
      .filter((item) => item.item_name.length > 0);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Tourenlisten-Erkennung (Foto-Auswahl, Schritt 3)                    */
/* ------------------------------------------------------------------ */

/** Erkannter Eintrag einer fotografierten Tourenliste. */
export type TourListEntry = {
  name: string | null;
  address: string | null;
};

const TOUR_LIST_SYSTEM_PROMPT = `Du bist ein präziser OCR-Assistent für eine Liefer- und Tourenplanungs-App. Ein Nutzer fotografiert eine ausgedruckte Tourenliste mit den heute anzufahrenden Objekten. Extrahiere alle Einträge als JSON.

Format-Antwort NUR als JSON-Objekt, ohne zusätzlichen Text:
{"entries":[{"name":"...","address":"..."}]}

Regeln:
- Jeder Eintrag entspricht genau einem anzufahrenden Objekt (Firma, Kunde, Objekt oder Treppenhaus).
- "name": Bezeichnung des Objekts, falls erkennbar (z. B. "Büro Meyer"), sonst null.
- "address": vollständige Adresse mit Straße und Hausnummer, falls erkennbar, sonst null.
- Mindestens "name" ODER "address" muss gefüllt sein.
- Fasse Name und Adresse aus getrennten Zeilen zu einem Eintrag zusammen.
- Ignoriere Häkchen, Nummerierungen, Seitennummern, Überschriften, Datumsangaben und Logos.
- Falls keine brauchbaren Einträge vorhanden sind: {"entries":[]}`;

const TOUR_LIST_USER_PROMPT =
  "Analysiere das Foto der Tourenliste und extrahiere alle Einträge als JSON.";

/** Gemini (Vision) für Tourenlisten aufrufen. */
export async function extractTourListEntries(
  imageBase64: string,
  mimeType: string,
): Promise<TourListEntry[]> {
  const content = await callGeminiVision(
    TOUR_LIST_SYSTEM_PROMPT,
    TOUR_LIST_USER_PROMPT,
    imageBase64,
    mimeType,
  );
  return parseTourListResult(content);
}

/** JSON aus der Antwort extrahieren und bereinigen. */
export function parseTourListResult(content: string): TourListEntry[] {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as {
      entries?: unknown;
    };
    if (!Array.isArray(parsed.entries)) return [];

    return parsed.entries
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null,
      )
      .map((entry) => ({
        name:
          typeof entry.name === "string" && entry.name.trim()
            ? entry.name.trim()
            : null,
        address:
          typeof entry.address === "string" && entry.address.trim()
            ? entry.address.trim()
            : null,
      }))
      .filter((entry) => entry.name !== null || entry.address !== null);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Objekt-Matching (Foto-Auswahl, Schritt 3)                           */
/* ------------------------------------------------------------------ */

export type ObjectMatchTarget = { id: string; name: string; address: string };

export type ObjectMatchResult = {
  object_id: string;
  matched_by: "adresse" | "name";
};

/**
 * Ordnet einen erkannten Tourenlisten-Eintrag einem bestehenden Objekt zu.
 * Strategie: exakte Adresse > exakter Name > bester Fuzzy-Treffer (>= 0.8).
 */
export function findMatchingObjectId(
  entry: TourListEntry,
  objects: ObjectMatchTarget[],
): ObjectMatchResult | null {
  const normAddr = entry.address ? normalizeAddress(entry.address) : "";
  const normName = entry.name ? normalizeAddress(entry.name) : "";

  // 1) Exakte Adresse
  if (normAddr.length >= 5) {
    for (const obj of objects) {
      if (normalizeAddress(obj.address) === normAddr) {
        return { object_id: obj.id, matched_by: "adresse" };
      }
    }
  }

  // 2) Exakter Name
  if (normName.length >= 3) {
    for (const obj of objects) {
      if (normalizeAddress(obj.name) === normName) {
        return { object_id: obj.id, matched_by: "name" };
      }
    }
  }

  // 3) Bester Fuzzy-Treffer über Adresse oder Name
  let best: {
    object_id: string;
    score: number;
    matched_by: "adresse" | "name";
  } | null = null;

  for (const obj of objects) {
    if (normAddr.length >= 5) {
      const score = similarity(normAddr, normalizeAddress(obj.address));
      if (score > (best?.score ?? 0)) {
        best = { object_id: obj.id, score, matched_by: "adresse" };
      }
    }
    if (normName.length >= 3) {
      const score = similarity(normName, normalizeAddress(obj.name));
      if (score > (best?.score ?? 0)) {
        best = { object_id: obj.id, score, matched_by: "name" };
      }
    }
  }

  return best && best.score >= 0.8
    ? { object_id: best.object_id, matched_by: best.matched_by }
    : null;
}

/* ------------------------------------------------------------------ */
/* Schlüssel-Erkennung (Foto → Objektname + Schlüsselnummer, Schritt 8) */
/* ------------------------------------------------------------------ */

/** Aus einem Foto erkannte Schlüssel-Zuordnung (Name + Schlüsselnummer). */
export type ExtractedKey = {
  name: string | null;
  key_number: number;
};

const KEYS_SYSTEM_PROMPT = `Du bist ein präziser OCR-Assistent für eine Liefer- und Tourenplanungs-App. Ein Nutzer fotografiert eine Schlüsselliste / Schlüsselplan mit Objektnamen und den dazugehörigen Schlüsselnummern. Extrahiere alle Einträge als strukturiertes JSON.

Format-Antwort NUR als JSON-Objekt, ohne zusätzlichen Text:
{"keys": [{"name": "Büro Meyer", "key_number": 5}]}

Regeln:
- "name": Bezeichnung des Objekts, wie auf dem Zettel (kann abgekürzt sein, z. B. "B. Meyer", "BM" oder ein verwandter Name) – Pflichtfeld, sofern erkennbar, sonst null.
- "key_number": zugehörige Schlüsselnummer als positive ganze Zahl – Pflichtfeld.
- Fasse Name und Nummer aus getrennten Zeilen zu einem Eintrag zusammen.
- Ignoriere Überschriften, Seitennummern, Logos und unlesbare Einträge.
- Falls das Bild keine brauchbare Schlüsselliste enthält: {"keys":[]}`;

const KEYS_USER_PROMPT =
  "Analysiere das Foto der Schlüsselliste und extrahiere alle Einträge als JSON.";

/** Gemini (Vision) aufrufen und erkannte Schlüssel-Zuordnungen zurückgeben. */
export async function extractKeysFromImage(
  imageBase64: string,
  mimeType: string,
): Promise<ExtractedKey[]> {
  const content = await callGeminiVision(
    KEYS_SYSTEM_PROMPT,
    KEYS_USER_PROMPT,
    imageBase64,
    mimeType,
  );
  return parseKeysResult(content);
}

/** JSON aus der Antwort extrahieren, validieren und bereinigen. */
export function parseKeysResult(content: string): ExtractedKey[] {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as {
      keys?: unknown;
    };
    if (!Array.isArray(parsed.keys)) return [];

    return parsed.keys
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null,
      )
      .map((entry) => {
        const keyNumber = Number(entry.key_number);
        return {
          name:
            typeof entry.name === "string" && entry.name.trim()
              ? entry.name.trim().slice(0, 200)
              : null,
          key_number:
            Number.isInteger(keyNumber) && keyNumber > 0 ? keyNumber : 0,
        };
      })
      .filter((key) => key.key_number > 0);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Objekt-Items-Erkennung (Foto → Objekt + Items, Schritt 8)           */
/* ------------------------------------------------------------------ */

/** Aus einem Foto erkannte Gruppe: Objekt-Hinweis (Name/Adresse) + Items. */
export type ExtractedItemGroup = {
  name: string | null;
  address: string | null;
  items: ExtractedItem[];
};

const ITEM_GROUPS_SYSTEM_PROMPT = `Du bist ein präziser OCR-Assistent für eine Liefer- und Tourenplanungs-App. Ein Nutzer fotografiert einen Zettel / eine Packliste, auf der oben der Name des Objekts (oft auch die Adresse) steht und darunter die zu liefernden Items. Extrahiere alle Einträge als strukturiertes JSON.

Format-Antwort NUR als JSON-Objekt, ohne zusätzlichen Text:
{"groups": [{"name": "Büro Meyer", "address": "Hauptstraße 12, 12345 Musterstadt", "items": [{"quantity": 60, "item_name": "Micromops", "note": "rot, gelb - kein blau"}]}]}

Regeln:
- Jede Gruppe entspricht einem Objekt: "name" (Bezeichnung, kann abgekürzt sein) und/oder "address" (Straße + Hausnummer) – mindestens eines muss gefüllt sein.
- "items": die Liste der zu liefernden Gegenstände des Objekts.
  - "quantity": Menge als positive ganze Zahl, falls eine Zahl erkennbar ist, sonst 1.
  - "item_name": Bezeichnung des Gegenstands – Pflichtfeld.
  - "note": optionale Bemerkung, sonst null.
- Fasse zusammengehörige Zeilen (Menge + Bezeichnung + Bemerkung) zu einem Item zusammen.
- Stehen mehrere Objekte auf dem Zettel, lege für jedes eine Gruppe an.
- Ignoriere Überschriften, Seitennummern, Logos und unlesbare Einträge.
- Falls das Bild keine brauchbare Liste enthält: {"groups":[]}`;

const ITEM_GROUPS_USER_PROMPT =
  "Analysiere das Foto und extrahiere Objekt samt Items als JSON.";

/** Gemini (Vision) aufrufen und erkannte Objekt-Item-Gruppen zurückgeben. */
export async function extractItemGroupsFromImage(
  imageBase64: string,
  mimeType: string,
): Promise<ExtractedItemGroup[]> {
  const content = await callGeminiVision(
    ITEM_GROUPS_SYSTEM_PROMPT,
    ITEM_GROUPS_USER_PROMPT,
    imageBase64,
    mimeType,
  );
  return parseItemGroupsResult(content);
}

/** JSON aus der Antwort extrahieren, validieren und bereinigen. */
export function parseItemGroupsResult(content: string): ExtractedItemGroup[] {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as {
      groups?: unknown;
    };
    if (!Array.isArray(parsed.groups)) return [];

    return parsed.groups
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null,
      )
      .map((entry) => {
        const rawItems = Array.isArray(entry.items) ? entry.items : [];
        const items = rawItems
          .filter(
            (item): item is Record<string, unknown> =>
              typeof item === "object" && item !== null,
          )
          .map((item) => {
            const itemName =
              typeof item.item_name === "string" ? item.item_name.trim() : "";
            const quantity = Number(item.quantity);
            return {
              item_name: itemName,
              quantity:
                Number.isInteger(quantity) && quantity > 0 ? quantity : 1,
              note:
                typeof item.note === "string" && item.note.trim()
                  ? item.note.trim().slice(0, 300)
                  : null,
            };
          })
          .filter((item) => item.item_name.length > 0);

        return {
          name:
            typeof entry.name === "string" && entry.name.trim()
              ? entry.name.trim().slice(0, 200)
              : null,
          address:
            typeof entry.address === "string" && entry.address.trim()
              ? entry.address.trim()
              : null,
          items,
        };
      })
      .filter((group) => group.items.length > 0);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Namens-Matching (inkl. Abkürzungen & verwandte Namen)               */
/* ------------------------------------------------------------------ */

/**
 * Ordnet einen erkannten Namen einem bestehenden Objekt zu.
 * Strategie: exakter Name > Token-Ähnlichkeit (>= 0.6) > Abkürzungs-Prefix
 * (z. B. "BM" → "Büro Meyer", "B. Meyer" → "Büro Meyer") > Teilstring.
 */
export function findBestObjectByName(
  name: string | null,
  objects: ObjectMatchTarget[],
): { object_id: string; matched_by: "name" } | null {
  if (!name) return null;
  const norm = normalizeAddress(name);
  if (norm.length < 2) return null;

  // 1) Exakter Name (normalisiert)
  for (const obj of objects) {
    if (normalizeAddress(obj.name) === norm) {
      return { object_id: obj.id, matched_by: "name" };
    }
  }

  // 2) Token-Ähnlichkeit
  let best: { object_id: string; score: number } | null = null;
  for (const obj of objects) {
    const score = similarity(norm, normalizeAddress(obj.name));
    if (score > (best?.score ?? 0)) {
      best = { object_id: obj.id, score };
    }
  }
  if (best && best.score >= 0.6) {
    return { object_id: best.object_id, matched_by: "name" };
  }

  // 3) Abkürzung / Initialen-Prefix: "BM" passt auf "Büro Meyer",
  //    "B. Meyer" passt auf "Büro Meyer".
  const initials = (value: string) =>
    value
      .split(" ")
      .filter((word) => word.length > 0)
      .map((word) => word[0])
      .join("")
      .toLowerCase();
  const normInitials = initials(norm);
  for (const obj of objects) {
    const objNorm = normalizeAddress(obj.name);
    const objInitials = initials(objNorm);
    if (normInitials.length >= 2 && objInitials.startsWith(normInitials)) {
      return { object_id: obj.id, matched_by: "name" };
    }
    // "B. Meyer" / "Büro Meyer": beide enthalten "meyer"
    const lastName = norm.split(" ").pop() ?? "";
    if (
      lastName.length >= 4 &&
      objNorm.includes(lastName) &&
      normInitials[0] === objInitials[0]
    ) {
      return { object_id: obj.id, matched_by: "name" };
    }
  }

  // 4) Teilstring (kurzer Name steckt im längeren)
  for (const obj of objects) {
    const objNorm = normalizeAddress(obj.name);
    if (norm.length >= 3 && objNorm.includes(norm)) {
      return { object_id: obj.id, matched_by: "name" };
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Duplikaterkennung                                                   */
/* ------------------------------------------------------------------ */

/** Adresse für Vergleich normalisieren (Kleinschreibung, ohne Satzzeichen). */
export function normalizeAddress(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,;:()/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token-Überlappung als Ähnlichkeitsmaß (0..1). */
export function similarity(a: string, b: string): number {
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let common = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) common += 1;
  }
  return (2 * common) / (tokensA.size + tokensB.size);
}

/**
 * Findet die Adresse eines bestehenden Objekts, das zur normalisierten
 * Eingabe passt (exakt oder per Fuzzy-Match). Gibt null zurück, wenn keins.
 */
export function findDuplicate(
  normalizedAddress: string,
  existingNormalizedAddresses: string[],
): string | null {
  // Exakter Treffer
  if (existingNormalizedAddresses.includes(normalizedAddress)) {
    return normalizedAddress;
  }
  // Fuzzy-Match
  for (const existing of existingNormalizedAddresses) {
    if (
      existing.length >= 5 &&
      normalizedAddress.length >= 5 &&
      similarity(normalizedAddress, existing) >= 0.75
    ) {
      return existing;
    }
  }
  return null;
}
