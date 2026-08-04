import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { orsGeocodeSearch, WUERZBURG_BOUNDARY } from "@/lib/ors";
import { hasHouseNumber } from "@/lib/utils";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/geocoding/company-address
 *
 * Sucht automatisch die Adresse zu einem Kunden/Objektnamen – nur innerhalb
 * von Würzburg (boundary.rect). Gleiche Teile (z. B. wenn Kunde = Name) werden
 * nur einmal übernommen, "Würzburg" wird ergänzt. Ergebnis ist eine exakte
 * Adresse (Label + Koordinaten), die direkt in die Adresszeile eingetragen
 * werden kann.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const customer =
      typeof body.customer === "string" ? body.customer.trim() : "";

    if (!name && !customer) {
      return NextResponse.json({ status: "not_found" });
    }

    if (!process.env.ORS_API_KEY) {
      return NextResponse.json(
        { error: "ORS_API_KEY ist nicht konfiguriert.", code: "ORS_NOT_CONFIGURED" },
        { status: 503 },
      );
    }

    const parts: string[] = [];
    const add = (value: string) => {
      if (!value) return;
      const normalized = value.toLowerCase();
      if (parts.some((p) => p.toLowerCase() === normalized)) return;
      parts.push(value);
    };
    add(customer);
    add(name);
    parts.push("Würzburg");

    const hit = await orsGeocodeSearch(parts.join(", "), {
      boundary: WUERZBURG_BOUNDARY,
    });

    // Nur exakte Adressen (mit Hausnummer) automatisch übernehmen.
    if (!hit || !hasHouseNumber(hit.label)) {
      return NextResponse.json({ status: "not_found" });
    }

    return NextResponse.json({
      status: "ok",
      address: hit.label,
      latitude: hit.latitude,
      longitude: hit.longitude,
    });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
