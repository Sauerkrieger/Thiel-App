import { NextResponse } from "next/server";
import { normalizeAddressForGeocoding, orsGeocodeSearch } from "@/lib/ors";

export const dynamic = "force-dynamic";

/**
 * POST /api/geocoding/verify
 *
 * Verifiziert eine manuell eingetippte Adresse per ORS-Geocode-Search und
 * liefert den vermutlich passenden Treffer (normalisiertes Label + Koordinaten).
 * Der Client nutzt das, wenn der Nutzer eine Adresse tippt, ohne einen
 * Autocomplete-Vorschlag anzuklicken.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const address =
    typeof body.address === "string" ? body.address.trim() : "";

  if (address.length < 5) {
    return NextResponse.json({ verified: false });
  }

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ORS_API_KEY ist nicht konfiguriert.", code: "ORS_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const hit = await orsGeocodeSearch(normalizeAddressForGeocoding(address));
  if (!hit) {
    return NextResponse.json({ verified: false });
  }

  return NextResponse.json({ verified: true, suggestion: hit });
}
