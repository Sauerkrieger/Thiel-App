import { NextResponse } from "next/server";
import { orsAuthorizationHeader } from "@/lib/ors";

export const dynamic = "force-dynamic";

/**
 * Adress-Autocomplete über OpenRouteService (ORS) Geocoding.
 *
 * Proxy-Route, damit der ORS_API_KEY nicht im Client landet.
 * Ergebnisse werden standardmäßig auf Deutschland (DEU) begrenzt.
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

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ORS_API_KEY ist nicht konfiguriert.", code: "ORS_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

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
      return NextResponse.json(
        { error: "Geocoding-Dienst ist gerade nicht erreichbar." },
        { status: 502 },
      );
    }

    const json: { features?: OrsFeature[] } = await res.json();
    const features = Array.isArray(json.features) ? json.features : [];

    const suggestions: AddressSuggestion[] = features
      .map((f): AddressSuggestion | null => {
        const coords = f.geometry?.coordinates;
        const [lng, lat] = Array.isArray(coords) ? coords : [];
        const label = f.properties?.label?.trim();
        if (!label || !isNumber(lat) || !isNumber(lng)) return null;
        return {
          label,
          name: f.properties?.name?.trim() ?? "",
          latitude: lat,
          longitude: lng,
        };
      })
      .filter((s): s is AddressSuggestion => s !== null);

    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json(
      { error: "Geocoding-Dienst ist gerade nicht erreichbar." },
      { status: 502 },
    );
  }
}
