import { NextResponse } from "next/server";
import { orsAuthorizationHeader } from "@/lib/ors";
import { cleanAddressLabel } from "@/lib/address";
import { photonAutocomplete } from "@/lib/photon";

export const dynamic = "force-dynamic";

/**
 * Adress-Autocomplete über OpenRouteService (ORS) Geocoding.
 *
 * Proxy-Route, damit der ORS_API_KEY nicht im Client landet.
 * Ergebnisse werden standardmäßig auf Deutschland (DEU) begrenzt.
 *
 * Hinweis: Die Boundary-Filterung (Würzburg-Rechteck) findet bewusst erst
 * beim Verifizieren (Blur/POST verify) statt – das Autocomplete soll alle
 * deutschen Treffer zeigen, damit der Nutzer beim Tippen nicht ins Leere
 * läuft und die Vorschläge trotzdem vollständig sieht.
 *
 * Fallback: Wenn ORS nicht verfügbar ist oder keine Ergebnisse liefert,
 * wird die Photon-API (Komoot) als Fuzzy-Autocomplete verwendet.
 */

const ORS_AUTOCOMPLETE_URL = "https://api.openrouteservice.org/geocode/autocomplete";
const MIN_QUERY_LENGTH = 3;
const MAX_RESULTS = 6;
const COUNTRY_FILTER = "DEU";

type OrsFeature = {
  geometry?: { coordinates?: unknown };
  properties?: {
    label?: string;
    name?: string;
    layer?: string;
    locality?: string;
    postalcode?: string;
  };
};

export type AddressSuggestion = {
  /** Vollständige, anzeigbare Adresse (z. B. "Hauptstraße 12, 12345 Musterstadt"). */
  label: string;
  name: string;
  latitude: number;
  longitude: number;
};

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ suggestions: [] });
  }

  // 1. Photon-Autocomplete (Fuzzy, toleriert Tippfehler – läuft immer zuerst)
  const photonSuggestions = await photonAutocomplete(q, { limit: MAX_RESULTS });

  // Wenn kein ORS-Key konfiguriert ist, direkt Photon-Ergebnisse zurückgeben
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ suggestions: photonSuggestions });
  }

  // 2. ORS-Autocomplete (exakte Suche – ergänzt Photon-Ergebnisse)
  try {
    const url = new URL(ORS_AUTOCOMPLETE_URL);
    url.searchParams.set("text", q);
    url.searchParams.set("size", String(MAX_RESULTS));
    url.searchParams.set("lang", "de");
    url.searchParams.set("boundary.country", COUNTRY_FILTER);

    const res = await fetch(url, {
      headers: { Authorization: orsAuthorizationHeader(apiKey) },
      cache: "no-store",
    });

    if (!res.ok) {
      // ORS nicht erreichbar – Photon-Ergebnisse verwenden
      return NextResponse.json({ suggestions: photonSuggestions });
    }

    const json: { features?: OrsFeature[] } = await res.json();
    const features = Array.isArray(json.features) ? json.features : [];

    const orsSuggestions: AddressSuggestion[] = features
      .map((f): AddressSuggestion | null => {
        const coords = f.geometry?.coordinates;
        const [lng, lat] = Array.isArray(coords) ? coords : [];
        const label = f.properties?.label?.trim();
        if (!label || !isNumber(lat) || !isNumber(lng)) return null;
        return {
          label: cleanAddressLabel(label),
          name: f.properties?.name?.trim() ?? "",
          latitude: lat,
          longitude: lng,
        };
      })
      .filter((s): s is AddressSuggestion => s !== null);

    // Photon + ORS zusammenführen: Photon zuerst, ORS-Ergebnisse anhängen
    // (Dubletten anhand Label entfernen)
    const seen = new Set(photonSuggestions.map((s) => s.label.toLowerCase()));
    const merged = [
      ...photonSuggestions,
      ...orsSuggestions.filter((s) => !seen.has(s.label.toLowerCase())),
    ].slice(0, MAX_RESULTS);

    return NextResponse.json({ suggestions: merged });
  } catch {
    // ORS-Fehler – Photon-Ergebnisse verwenden
    return NextResponse.json({ suggestions: photonSuggestions });
  }
}
