/**
 * Adress-Helfer für die Anzeige von ORS-Geocoding-Labels.
 *
 * ORS hängt an Labels redundante Bestandteile an (z. B. „Deutschland“ oder
 * „Germany“). Diese Teile werden aus der Anzeige entfernt.
 */

import { SERVICE_CITY } from "@/lib/region";

/** Bestandteile, die am Ende einer Adresse als redundant gelten (exakte Komponente). */
const REDUNDANT_PARTS: RegExp[] = [/^deutschland$/i, /^germany$/i];

/**
 * Entfernt redundante Landes-Teile aus einem ORS-Label,
 * z. B. "12 Example Street, 12345 Example Town, Germany"
 * -> "12 Example Street, 12345 Example Town".
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
/* Einsatzgebiets-Regel                                               */
/* ------------------------------------------------------------------ */

/**
 * Zentrale Adressregel (v. a. Foto-Import): Ist ein Einsatzgebiet
 * konfiguriert (`NEXT_PUBLIC_SERVICE_CITY`), gilt eine Adresse ohne
 * Ortsangabe als Adresse im Einsatzgebiet. Nennt die Adresse explizit eine
 * andere Stadt, bleibt diese erhalten. Diese Helfer werden sowohl
 * serverseitig (Analyse/Import/Verify) als auch clientseitig
 * (Live-Validierung beim Tippen/Pasten) verwendet.
 */

// Wortgrenze, damit „Musterstädter Straße 5, 12345 Anderswo“ NICHT als
// Einsatzgebiets-Ort erkannt wird, „12345 Musterstadt“ aber schon.
function cityPattern(city: string): RegExp {
  const variants = new Set<string>([city]);
  variants.add(
    city
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss"),
  );
  const escaped = [...variants]
    .filter(Boolean)
    .map((variant) => variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`\\b(?:${escaped})\\b`, "i");
}

const SERVICE_CITY_RE = SERVICE_CITY ? cityPattern(SERVICE_CITY) : null;

/** Ortsangabe am Ende nach Komma (z. B. ", 12345 Musterstadt" oder ", Anderswo"). */
const CITY_SUFFIX_RE =
  /(?:,\s*)(\d{5}\s+)?([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'-]*)\s*$/u;

/** PLZ + Ort am Ende (z. B. "12345 Musterstadt"). */
const PLZ_CITY_RE =
  /(?:^|\s)(\d{5})\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'-]*)\s*$/u;

export type AddressCityInfo = {
  /** Erkannte Stadt (null, wenn keine Ortsangabe erkennbar). */
  city: string | null;
  /** true, wenn die Adresse eine erkennbare Ortsangabe enthält. */
  hasCity: boolean;
  /** true, wenn die Ortsangabe der Einsatzgebiets-Stadt entspricht. */
  isServiceCity: boolean;
};

/**
 * Analysiert eine Adresse auf eine erkennbare Ortsangabe.
 *
 * Beispiele (Einsatzgebiet „Musterstadt“):
 *   "14 Example Street, 12345 Example Town" -> Musterstadt
 *   "12 Main Street, Elsewhere"              -> Anderswo (hasCity, nicht Einsatzgebiet)
 *   "Musterstraße 12"                       -> keine Ortsangabe
 *   "8a Garden Street"                       -> keine Ortsangabe (Hausnummer, kein Ort)
 */
export function analyzeAddressCity(address: string): AddressCityInfo {
  const trimmed = address.trim();
  if (!trimmed) return { city: null, hasCity: false, isServiceCity: false };

  if (SERVICE_CITY_RE && SERVICE_CITY_RE.test(trimmed)) {
    return { city: SERVICE_CITY, hasCity: true, isServiceCity: true };
  }

  const suffix = trimmed.match(CITY_SUFFIX_RE);
  if (suffix?.[2]?.trim()) {
    return {
      city: suffix[2].trim(),
      hasCity: true,
      isServiceCity: false,
    };
  }

  const plzCity = trimmed.match(PLZ_CITY_RE);
  if (plzCity?.[2]?.trim()) {
    return {
      city: plzCity[2].trim(),
      hasCity: true,
      isServiceCity: false,
    };
  }

  return { city: null, hasCity: false, isServiceCity: false };
}

/**
 * Stellt sicher, dass eine Adresse einen Ortsbestandteil hat. Fehlt die
 * Ortsangabe, wird `explicitCity` bzw. die konfigurierte Einsatzgebiets-Stadt
 * ergänzt. Ohne konfiguriertes Einsatzgebiet bleibt die Adresse unverändert.
 */
export function ensureAddressCity(
  address: string,
  explicitCity?: string | null,
): string {
  const trimmed = address.trim();
  if (!trimmed) return trimmed;
  if (analyzeAddressCity(trimmed).hasCity) return trimmed;
  const city = explicitCity?.trim() || SERVICE_CITY;
  if (!city) return trimmed;
  return `${trimmed}, ${city}`;
}

export type AddressCityIssue = {
  level: "missing-city" | "outside-service-area";
  message: string;
};

/**
 * Live-Validierung einer Adresseingabe (nach jedem Zeichen/Pasten):
 * liefert einen Hinweis, wenn die Ortsangabe fehlt oder – bei
 * `serviceAreaOnly` – eine andere Stadt als die des Einsatzgebiets genannt
 * wird. `null` = unauffällig.
 */
export function addressCityIssue(
  address: string,
  options?: { serviceAreaOnly?: boolean },
): AddressCityIssue | null {
  const trimmed = address.trim();
  if (!trimmed) return null;
  const info = analyzeAddressCity(trimmed);
  if (!info.hasCity) {
    return {
      level: "missing-city",
      message: SERVICE_CITY
        ? `City missing – the address is assumed to be “${SERVICE_CITY}”. Please add the city (e.g. “12345 ${SERVICE_CITY}”).`
        : "City missing – please add the city (e.g. “12 Main Street, 12345 Town”).",
    };
  }
  if (options?.serviceAreaOnly && SERVICE_CITY && !info.isServiceCity) {
    return {
      level: "outside-service-area",
      message: `Only ${SERVICE_CITY} allowed – unless the city was stated explicitly on the photo (detected: “${info.city}”).`,
    };
  }
  return null;
}
