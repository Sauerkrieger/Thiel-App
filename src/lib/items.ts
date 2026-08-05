/**
 * Helfer für strukturierte Items (Menge / Bezeichnung / Bemerkung).
 */

import type { DeliveryItem } from "@/types/api";

export type ItemLike = {
  item_name: string;
  quantity?: number | null;
  note?: string | null;
};

/**
 * Formatiert ein Item lesbar, z. B. "60x Micromops (rot, gelb - kein blau)".
 * Menge 1 wird nicht angezeigt, Bemerkungen nur, wenn vorhanden.
 */
export function formatItemLabel(item: ItemLike): string {
  const quantity = item.quantity ?? 1;
  const label = quantity > 1 ? `${quantity}x ${item.item_name}` : item.item_name;
  const note = item.note?.trim();
  return note ? `${label} (${note})` : label;
}

/**
 * Erkennt die beim Foto-Import automatisch als Standard vorgesehenen Items.
 *
 * OCR liefert gelegentlich Schreibfehler, Bindestriche oder Singularformen.
 * Deshalb werden Umlaute/Trennzeichen normalisiert und die bekannten
 * Item-Stämme mit einer kleinen toleranten Levenshtein-Prüfung gesucht.
 */
const PHOTO_IMPORT_STANDARD_ITEM_ROOTS = [
  "micromop",
  "mikromop",
  "franzenmop",
  "fransenmop",
  "mpower",
  "microfasertuch",
  "mikrofasertuch",
  "polierleine",
  "waffeltuch",
] as const;

function normalizeItemName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function editDistanceAtMost(left: string, right: string, maxDistance: number): boolean {
  if (Math.abs(left.length - right.length) > maxDistance) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);

  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maxDistance) return false;
    previous = current;
  }

  return previous[right.length] <= maxDistance;
}

/** true für die sechs Foto-Import-Standardgruppen (inkl. OCR-Varianten). */
export function isPhotoImportStandardItem(itemName: string): boolean {
  const words = itemName
    .split(/[^\\p{L}\\p{N}]+/u)
    .map(normalizeItemName)
    .filter(Boolean);
  if (words.length === 0) return false;

  // Auch getrennte OCR-Wörter wie „micro faser tücher“ prüfen.
  const candidates = [...words];
  for (let size = 2; size <= 3; size += 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      candidates.push(words.slice(start, start + size).join(""));
    }
  }

  return PHOTO_IMPORT_STANDARD_ITEM_ROOTS.some((root) =>
    candidates.some((candidate) => {
      // Pluralformen und Zusätze wie Farben werden über den Stamm erkannt.
      if (candidate.includes(root)) return true;

      // Ähnliche Wörter wie „mower“ dürfen nicht als „mpower“ gelten.
      // Bei echten OCR-Schreibfehlern wie „mpwer“ bleibt „mp“ erhalten.
      if (root === "mpower" && !candidate.startsWith("mp")) return false;

      // Nur ein kompletter Wort-/Wortgruppen-Kandidat darf fuzzy passen;
      // dadurch werden zufällige Teilstrings nicht als Standard markiert.
      const maxDistance = 2;
      return (
        Math.abs(candidate.length - root.length) <= maxDistance &&
        editDistanceAtMost(candidate, root, maxDistance)
      );
    }),
  );
}

/** Validierter Item-Input, wie ihn die API-Routen erwarten. */
export type ItemInput = {
  item_name: string;
  quantity: number;
  note: string | null;
  photo_path: string | null;
  is_always_required: boolean;
};

const MAX_ITEM_NAME = 200;
const MAX_NOTE = 300;
const MAX_QUANTITY = 1_000_000;
export const MAX_PHOTO_PATH = 500;

/** Parst ein einzelnes Item-Objekt; null bei ungültigen Werten. */
export function parseItemInput(value: unknown): ItemInput | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const itemName = typeof raw.item_name === "string" ? raw.item_name.trim() : "";
  if (!itemName || itemName.length > MAX_ITEM_NAME) return null;

  let quantity = 1;
  if (raw.quantity !== undefined && raw.quantity !== null) {
    const parsed = Number(raw.quantity);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_QUANTITY) {
      return null;
    }
    quantity = parsed;
  }

  let note: string | null = null;
  if (typeof raw.note === "string") {
    const trimmed = raw.note.trim();
    if (trimmed) {
      if (trimmed.length > MAX_NOTE) return null;
      note = trimmed;
    }
  }

  let photoPath: string | null = null;
  if (typeof raw.photo_path === "string") {
    const trimmed = raw.photo_path.trim();
    if (trimmed) {
      if (trimmed.length > MAX_PHOTO_PATH) return null;
      photoPath = trimmed;
    }
  }

  return {
    item_name: itemName,
    quantity,
    note,
    photo_path: photoPath,
    is_always_required: Boolean(raw.is_always_required),
  };
}

/** Parst ein Array von Items; null, wenn ein Eintrag ungültig ist. */
export function parseItemInputs(value: unknown): ItemInput[] | null {
  if (!Array.isArray(value)) return null;
  const result: ItemInput[] = [];
  for (const entry of value) {
    const parsed = parseItemInput(entry);
    if (!parsed) return null;
    result.push(parsed);
  }
  return result;
}

const MAX_DELIVERY_NOTE = 300;
const MAX_DELIVERY_ITEMS = 500;

/**
 * Normalisiert next_delivery_items in eine Liste aus { item_name, note }.
 * Akzeptiert sowohl die neue Objektform als auch Legacy-Einträge (reine Strings).
 * Ungültige Einträge werden verworfen.
 */
export function parseDeliveryItems(value: unknown): DeliveryItem[] {
  if (!Array.isArray(value)) return [];
  const result: DeliveryItem[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    let itemName = "";
    let note: string | null = null;
    if (typeof entry === "string") {
      itemName = entry.trim();
    } else if (typeof entry === "object" && entry !== null) {
      const raw = entry as Record<string, unknown>;
      if (typeof raw.item_name !== "string") continue;
      itemName = raw.item_name.trim();
      if (typeof raw.note === "string" && raw.note.trim()) {
        note = raw.note.trim();
      }
    }
    if (!itemName || itemName.length > MAX_ITEM_NAME) continue;
    if (note && note.length > MAX_DELIVERY_NOTE) continue;
    if (seen.has(itemName)) continue;
    seen.add(itemName);
    result.push({ item_name: itemName, note });
  }
  return result.slice(0, MAX_DELIVERY_ITEMS);
}
