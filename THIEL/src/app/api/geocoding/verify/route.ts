import { NextResponse } from "next/server";
import { analyzeAddressCity } from "@/lib/address";
import {
  normalizeAddressForGeocoding,
  orsGeocodeSearch,
  WUERZBURG_BOUNDARY,
} from "@/lib/ors";
import { photonGeocodeSearch } from "@/lib/photon";

export const dynamic = "force-dynamic";

/**
 * POST /api/geocoding/verify
 *
 * Verifiziert eine manuell eingetippte Adresse per ORS-Geocode-Search und
 * liefert den vermutlich passenden Treffer (normalisiertes Label + Koordinaten).
 * Der Client nutzt das, wenn der Nutzer eine Adresse tippt, ohne einen
 * Autocomplete-Vorschlag anzuklicken.
 *
 * Fallback: Wenn ORS nichts findet (z. B. bei Tippfehlern wie
 * "Hörleinsgasse" statt "Hörleingasse"), wird die Photon-API von Komoot
 * als Fuzzy-Suche verwendet. Photon ist toleranter gegenüber
 * Rechtschreibfehlern und kostenlos (kein API-Key nötig).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const address =
    typeof body.address === "string" ? body.address.trim() : "";

  if (address.length < 5) {
    return NextResponse.json({ verified: false });
  }

  // Würzburg-Regel: Nennt die Adresse explizit eine andere Stadt, wird ohne
  // Begrenzung gesucht. Ohne Ortsangabe (oder mit Würzburg) wird die Suche auf
  // das Würzburger Stadtgebiet begrenzt – so landet eine getippte Adresse ohne
  // Stadt nie irgendwo in Deutschland.
  const city = analyzeAddressCity(address);
  const boundary =
    city.hasCity && !city.isWuerzburg ? undefined : WUERZBURG_BOUNDARY;
  const normalized = normalizeAddressForGeocoding(address);

  // 1. Photon (Fuzzy, toleriert Tippfehler – läuft immer zuerst)
  let hit = await photonGeocodeSearch(normalized, { boundary });

  // 2. ORS (exakte Suche – Fallback wenn Photon nichts findet)
  if (!hit) {
    hit = await orsGeocodeSearch(normalized, { boundary });
  }

  if (!hit) {
    return NextResponse.json({ verified: false });
  }

  return NextResponse.json({ verified: true, suggestion: hit });
}
