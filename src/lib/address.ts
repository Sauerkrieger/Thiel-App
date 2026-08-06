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

/* ------------------------------------------------------------------ */
/* Würzburg-Regel                                                     */
/* ------------------------------------------------------------------ */

/**
 * Zentrale Adressregel (v. a. Foto-Import): Jede Adresse darf nur Würzburg
 * sein – es sei denn, auf dem Foto/Zettel steht explizit eine andere Stadt.
 * Ohne Ortsangabe wird deshalb Würzburg angenommen. Diese Helfer werden
 * sowohl serverseitig (Analyse/Import/Verify) als auch clientseitig
 * (Live-Validierung beim Tippen/Pasten) verwendet.
 */

// Wortgrenze, damit „Würzburger Straße 5, 97199 Ochsenfurt“ NICHT als
// Würzburg erkannt wird (die Straße existiert auch in anderen Städten),
// „97072 Würzburg“ und „Würzburg-Altstadt“ aber schon.
const WUERZBURG_RE = /\bwürzburg\b|\bwuerzburg\b/i;

/** Ortsangabe am Ende nach Komma (z. B. ", 97072 Würzburg" oder ", Ochsenfurt"). */
const CITY_SUFFIX_RE =
  /(?:,\s*)(\d{5}\s+)?([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'-]*)\s*$/u;

/** PLZ + Ort am Ende (z. B. "97072 Würzburg"). */
const PLZ_CITY_RE =
  /(?:^|\s)(\d{5})\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'-]*)\s*$/u;

export type AddressCityInfo = {
  /** Erkannte Stadt (null, wenn keine Ortsangabe erkennbar). */
  city: string | null;
  /** true, wenn die Adresse eine erkennbare Ortsangabe enthält. */
  hasCity: boolean;
  /** true, wenn die Ortsangabe explizit Würzburg lautet. */
  isWuerzburg: boolean;
};

/**
 * Analysiert eine Adresse auf eine erkennbare Ortsangabe.
 *
 * Beispiele:
 *   "Sartoriusstraße 14, 97072 Würzburg" -> Würzburg
 *   "Hauptstraße 12, Ochsenfurt"          -> Ochsenfurt (hasCity, nicht Würzburg)
 *   "Musterstraße 12"                     -> keine Ortsangabe
 *   "Gartenstraße 8a"                     -> keine Ortsangabe (Hausnummer, kein Ort)
 */
export function analyzeAddressCity(address: string): AddressCityInfo {
  const trimmed = address.trim();
  if (!trimmed) return { city: null, hasCity: false, isWuerzburg: false };

  if (WUERZBURG_RE.test(trimmed)) {
    return { city: "Würzburg", hasCity: true, isWuerzburg: true };
  }

  const suffix = trimmed.match(CITY_SUFFIX_RE);
  if (suffix?.[2]?.trim()) {
    return {
      city: suffix[2].trim(),
      hasCity: true,
      isWuerzburg: false,
    };
  }

  const plzCity = trimmed.match(PLZ_CITY_RE);
  if (plzCity?.[2]?.trim()) {
    return {
      city: plzCity[2].trim(),
      hasCity: true,
      isWuerzburg: false,
    };
  }

  return { city: null, hasCity: false, isWuerzburg: false };
}

/**
 * Stellt sicher, dass eine Adresse einen Ortsbestandteil hat. Fehlt die
 * Ortsangabe, wird `explicitCity` bzw. standardmäßig „Würzburg“ ergänzt.
 * So landet eine Adresse ohne Stadt nie „irgendwo in Deutschland“, sondern
 * immer im Würzburger Stadtgebiet.
 */
export function ensureAddressCity(
  address: string,
  explicitCity?: string | null,
): string {
  const trimmed = address.trim();
  if (!trimmed) return trimmed;
  if (analyzeAddressCity(trimmed).hasCity) return trimmed;
  const city = explicitCity?.trim() || "Würzburg";
  return `${trimmed}, ${city}`;
}

export type AddressCityIssue = {
  level: "missing-city" | "non-wuerzburg";
  message: string;
};

/**
 * Live-Validierung einer Adresseingabe (nach jedem Zeichen/Pasten):
 * liefert einen Hinweis, wenn die Ortsangabe fehlt oder – bei
 * `wuerzburgOnly` – eine andere Stadt als Würzburg genannt wird.
 * `null` = unauffällig.
 */
export function addressCityIssue(
  address: string,
  options?: { wuerzburgOnly?: boolean },
): AddressCityIssue | null {
  const trimmed = address.trim();
  if (!trimmed) return null;
  const info = analyzeAddressCity(trimmed);
  if (!info.hasCity) {
    return {
      level: "missing-city",
      message:
        "Ort fehlt – die Adresse wird als „Würzburg“ übernommen. Bitte Ort ergänzen (z. B. „97072 Würzburg“).",
    };
  }
  if (options?.wuerzburgOnly && !info.isWuerzburg) {
    return {
      level: "non-wuerzburg",
      message: `Nur Würzburg zulässig – außer die Stadt stand explizit im Foto (erkannt: „${info.city}“).`,
    };
  }
  return null;
}
