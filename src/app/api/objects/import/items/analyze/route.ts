import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import {
  GeminiApiNotConfiguredError,
  extractItemGroupsFromImage,
  findMatchingObjectId,
  findBestObjectByName,
  type ExtractedItemGroup,
} from "@/lib/ocr";
import { orsGeocodeSearch, WUERZBURG_BOUNDARY } from "@/lib/ors";
import { hasHouseNumber } from "@/lib/utils";
import { isPhotoImportStandardItem } from "@/lib/items";
import { requireUser, isAdmin } from "@/lib/auth";
import type { ItemGroupImportPreview } from "@/types/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

type ResolvedGroupAddress = {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geocoding_status: "ok" | "not_found";
};

/**
 * Sucht für eine nicht zugeordnete Items-Gruppe die exakte Adresse (Straße +
 * Hausnummer). Stand auf dem Zettel nur der Name und/oder der Ort, wird die
 * Adresse per ORS-Geocoding gesucht („Firma googeln“ anhand der Bild-Infos).
 */
async function resolveItemGroupAddress(
  group: ExtractedItemGroup,
): Promise<ResolvedGroupAddress> {
  // Steht auf dem Zettel bereits eine Straße + Hausnummer, wird nur damit
  // (plus Ort) geocodiert – der Firmenname könnte sonst einen falschen
  // Treffer nach vorne ziehen. Sonst wird über Kunde + Objektname (+ Ort)
  // gesucht – leere Teile fallen weg, wenn z. B. nur der Kunde oder nur der
  // Objektname etwas Sagendes ist.
  const hasOcrAddress = hasHouseNumber(group.address ?? "");
  const parts = hasOcrAddress
    ? [group.address, group.city]
    : [group.name, group.customer, group.address, group.city];
  const query = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");

  // Steht kein Ort auf dem Zettel (z. B. nur Kunde/Name), muss die Adresse
  // geraten werden – die Suche wird dann auf das Würzburger Stadtgebiet
  // begrenzt. Nennt der Zettel einen anderen Ort (z. B. Ochsenfurt), wird
  // dieser verwendet (keine Begrenzung).
  const boundary = group.city?.trim() ? undefined : WUERZBURG_BOUNDARY;
  const hit = query ? await orsGeocodeSearch(query, { boundary }) : null;

  if (hit) {
    if (hasHouseNumber(hit.label)) {
      return {
        address: hit.label,
        latitude: hit.latitude,
        longitude: hit.longitude,
        geocoding_status: "ok",
      };
    }
    // ORS hat nur Ort/Straße aufgelöst – die exakte Adresse steht ggf. auf dem Zettel.
    if (hasHouseNumber(group.address ?? "")) {
      return {
        address: group.address,
        latitude: hit.latitude,
        longitude: hit.longitude,
        geocoding_status: "ok",
      };
    }
  }

  // Automatische Rettung per ORS: Steht auf dem Zettel KEINE exakte Adresse
  // (nur Kunde/Name – die Adresse müsste also geraten werden), wird automatisch
  // über Kunde + Objektname (+ Ort bzw. Würzburg) gesucht – ein Treffer mit
  // Hausnummer wird direkt übernommen. Eine aufgeschriebene Straße+Hausnummer
  // hat dagegen immer Vorrang und wird NIE durch die Namens-Suche überschrieben.
  if (!hasOcrAddress) {
    const companyParts: string[] = [];
    const addPart = (value: string | null | undefined) => {
      const v = value?.trim();
      if (!v) return;
      const normalized = v.toLowerCase();
      if (companyParts.some((p) => p.toLowerCase() === normalized)) return;
      companyParts.push(v);
    };
    addPart(group.customer);
    addPart(group.name);
    addPart(group.city);
    if (!group.city?.trim()) addPart("Würzburg");
    const companyHit =
      companyParts.length > 0
        ? await orsGeocodeSearch(companyParts.join(", "), { boundary })
        : null;
    if (companyHit && hasHouseNumber(companyHit.label)) {
      return {
        address: companyHit.label,
        latitude: companyHit.latitude,
        longitude: companyHit.longitude,
        geocoding_status: "ok",
      };
    }
  }

  // Kein exakter Treffer: Adresse vom Zettel behalten; der Nutzer ergänzt ggf.
  const ocrAddress = group.address?.trim() || null;
  // Ohne Ortsangabe auf dem Zettel ist die Adresse nicht als Würzburg-Adresse
  // verifizierbar (kein Treffer, keine Koordinaten) – sie darf NICHT ungeprüft
  // als „gefunden“ durchgehen, sondern wird als „Adresse fehlt“ markiert.
  // Steht ein Ort auf dem Zettel, ist die Zettel-Adresse dagegen vertrauenswürdig.
  const hasCityOnPaper = Boolean(group.city?.trim());
  return {
    address: ocrAddress,
    latitude: null,
    longitude: null,
    geocoding_status:
      ocrAddress !== null && hasHouseNumber(ocrAddress) && hasCityOnPaper
        ? "ok"
        : "not_found",
  };
}

/** POST /api/objects/import/items/analyze -> Vorauswahl: Objekt + Items. */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  if (!isAdmin(auth.user)) {
    return NextResponse.json(
      { error: "Nur Admins dürfen Items importieren." },
      { status: 403 },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Kein Bild hochgeladen." },
        { status: 400 },
      );
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Die Datei ist kein Bild." },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Das Bild ist größer als 10 MB." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const imageBase64 = buffer.toString("base64");

    const extracted = await extractItemGroupsFromImage(imageBase64, file.type);
    if (extracted.length === 0) {
      return NextResponse.json({ matches: [], unmatched: [] });
    }

    const supabase = getSupabaseAdmin();
    const { data: objects, error } = await supabase
      .from("objects")
      .select("id, name, address");
    if (error) throw error;
    const targets = (objects ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      address: o.address,
    }));

    const result: ItemGroupImportPreview = { matches: [], unmatched: [] };
    const unmatchedGroups: ExtractedItemGroup[] = [];

    for (const group of extracted) {
      // 1) Adresse- oder Name-Match (exakt/Fuzzy) wie bei der Tourenliste.
      //    Adresse + Ort zusammenfügen, da das Modell beides getrennt liefern kann.
      const fullAddress = [group.address, group.city]
        .filter((part): part is string => Boolean(part?.trim()))
        .map((part) => part.trim())
        .join(", ");
      const byEntry = findMatchingObjectId(
        { name: group.name, address: fullAddress },
        targets,
      );
      // 2) Falls kein Treffer: Namens-Match inkl. Abkürzungen
      const match = byEntry ?? findBestObjectByName(group.name, targets);
      const obj = match
        ? (objects ?? []).find((o) => o.id === match.object_id) ?? null
        : null;

      if (match && obj) {
        result.matches.push({
          object_id: obj.id,
          object_name: obj.name,
          address: obj.address,
          matched_by: match.matched_by,
          customer: group.customer,
          customer_number: group.customer_number,
          cleaning_interval: group.cleaning_interval,
          // Bekannte Standard-Items werden in der Vorschau automatisch
          // angekreuzt; alle anderen bleiben unverändert abwählbar.
          items: group.items.map((item) => ({
            ...item,
            is_always_required: isPhotoImportStandardItem(item.item_name),
          })),
        });
      } else {
        unmatchedGroups.push(group);
      }
    }

    // Nicht gefundene Objekte: exakte Adresse per Geocoding auflösen, damit
    // das neue Objekt immer mit Straße + Hausnummer angelegt werden kann.
    result.unmatched = await Promise.all(
      unmatchedGroups.map(async (group) => {
        const resolved = await resolveItemGroupAddress(group);
        return {
          name: group.name,
          address: resolved.address,
          city: group.city,
          category: group.category,
          customer: group.customer,
          customer_number: group.customer_number,
          cleaning_interval: group.cleaning_interval,
          // Bekannte Standard-Items werden in der Vorschau automatisch
          // angekreuzt; alle anderen bleiben unverändert abwählbar.
          items: group.items.map((item) => ({
            ...item,
            is_always_required: isPhotoImportStandardItem(item.item_name),
          })),
          latitude: resolved.latitude,
          longitude: resolved.longitude,
          geocoding_status: resolved.geocoding_status,
        };
      }),
    );

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof GeminiApiNotConfiguredError) {
      return NextResponse.json(
        { error: e.message, code: "GEMINI_NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    return apiErrorResponse(e);
  }
}
