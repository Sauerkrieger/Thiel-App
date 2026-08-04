/**
 * Adress-Helfer für die Anzeige von ORS-Geocoding-Labels.
 *
 * ORS hängt an Labels redundante Bestandteile an (z. B. "Bayern, Deutschland"
 * oder "BY, Deutschland"). Da alle Objekte in Bayern/Deutschland liegen,
 * werden diese Teile aus der Anzeige entfernt.
 */

/** Bestandteile, die am Ende einer Adresse als redundant gelten (exakte Komponente). */
const REDUNDANT_PARTS: RegExp[] = [
  /^deutschland$/i,
  /^by$/i,
  /^bayern$/i,
  /^freistaat\s+bayern$/i,
];

/**
 * Entfernt redundante Landes-/Bundesland-Teile aus einem ORS-Label,
 * z. B. "Musterstraße 12, 86150 Augsburg, Bayern, Deutschland"
 * -> "Musterstraße 12, 86150 Augsburg".
 */
export function cleanAddressLabel(label: string): string {
  const parts = label
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const kept = parts.filter(
    (part) => !REDUNDANT_PARTS.some((re) => re.test(part)),
  );
  return kept.join(", ");
}
