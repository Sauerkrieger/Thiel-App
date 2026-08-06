import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { ensureAddressCity } from "@/lib/address";
import {
  GeminiApiNotConfiguredError,
  extractItemGroupsFromImage,
  findMatchingObjectId,
  findBestObjectByName,
  findDuplicate,
  normalizeAddress,
  type ExtractedItemGroup,
} from "@/lib/ocr";
import { orsGeocodeSearch, WUERZBURG_BOUNDARY } from "@/lib/ors";
import { hasHouseNumber } from "@/lib/utils";
import {
  correctItemNameFromInventory,
  isPhotoImportStandardItem,
} from "@/lib/items";
import { requireUser, isAdmin } from "@/lib/auth";
import type { ItemGroupImportPreview } from "@/types/api";
import { resolveImageMimeType } from "@/lib/image-mime";

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
    // ORS hat nur Ort/Straße aufgelöst – die exakte Adresse steht ggf. auf
    // dem Zettel. Ortsangabe ergänzen: explizite Stadt vom Zettel oder –
    // Würzburg-Regel – standardmäßig „Würzburg“, damit die Adresse niemals
    // ohne Städtezusatz übernommen wird (sonst landet sie irgendwo in DE).
    if (hasHouseNumber(group.address ?? "")) {
      return {
        address: ensureAddressCity(group.address ?? "", group.city),
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
  if (!ocrAddress) {
    return {
      address: null,
      latitude: null,
      longitude: null,
      geocoding_status: "not_found",
    };
  }
  // Ohne Hausnummer ist die Adresse nicht exakt – als „Adresse fehlt“ markieren.
  if (!hasHouseNumber(ocrAddress)) {
    return {
      address: ocrAddress,
      latitude: null,
      longitude: null,
      geocoding_status: "not_found",
    };
  }
  // Würzburg-Regel: Steht auf dem Zettel kein Ort, gilt die Adresse als
  // Würzburger Adresse und erhält automatisch den Städtezusatz. Steht ein
  // expliziter Ort auf dem Zettel (z. B. Ochsenfurt), wird dieser übernommen.
  // Die Koordinaten ermittelt dann die Import-Route (Würzburg-Boundary).
  return {
    address: ensureAddressCity(ocrAddress, group.city),
    latitude: null,
    longitude: null,
    geocoding_status: "ok",
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
    const mimeType = resolveImageMimeType(file.type, file.name);
    if (!mimeType) {
      return NextResponse.json(
        { error: "Die Datei ist kein unterstütztes Bild. Bitte JPG, PNG, WEBP oder HEIC verwenden." },
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

    const extracted = await extractItemGroupsFromImage(imageBase64, mimeType);
    if (extracted.length === 0) {
      return NextResponse.json({ matches: [], unmatched: [] });
    }

    const supabase = getSupabaseAdmin();
    const [{ data: objects, error }, { data: inventoryItems, error: inventoryError }] =
      await Promise.all([
        supabase.from("objects").select("id, name, address"),
        supabase.from("inventory_items").select("name"),
      ]);
    if (error) throw error;
    if (inventoryError) throw inventoryError;
    const targets = (objects ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      address: o.address,
    }));
    const inventoryNames = (inventoryItems ?? []).map((item) => item.name);
    const existingAddresses = (objects ?? []).map((object) =>
      normalizeAddress(object.address),
    );
    const objectByNormalizedAddress = new Map(
      (objects ?? []).map((object) => [normalizeAddress(object.address), object]),
    );

    const result: ItemGroupImportPreview = { matches: [], unmatched: [] };
    const unmatchedGroups: {
      group: ExtractedItemGroup;
      similar_object: ItemGroupImportPreview["unmatched"][number]["similar_object"];
    }[] = [];

    for (const rawGroup of extracted) {
      const group: ExtractedItemGroup = {
        ...rawGroup,
        items: rawGroup.items.map((item) => ({
          ...item,
          item_name: correctItemNameFromInventory(
            item.item_name,
            inventoryNames,
          ),
        })),
      };
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

      const similarObject = match && obj
        ? {
            name: obj.name,
            address: obj.address,
            matched_by: match.matched_by,
          }
        : null;
      // Auch bei einem Treffer bleibt die Gruppe eine Neuanlage. Der Treffer
      // wird ausschließlich als Duplikatwarnung angezeigt.
      unmatchedGroups.push({ group, similar_object: similarObject });
    }

    // Jede erkannte Gruppe bleibt eine Neuanlage. Exakte/ähnliche Treffer
    // werden nur als Warnung mitgegeben und niemals einem Bestand zugeordnet.
    result.unmatched = await Promise.all(
      unmatchedGroups.map(async ({ group, similar_object: initialSimilarObject }) => {
        const resolved = await resolveItemGroupAddress(group);
        let similar_object = initialSimilarObject;
        if (!similar_object && resolved.address) {
          const duplicateAddress = findDuplicate(
            normalizeAddress(resolved.address),
            existingAddresses,
          );
          const duplicateObject = duplicateAddress
            ? objectByNormalizedAddress.get(duplicateAddress)
            : null;
          if (duplicateObject) {
            similar_object = {
              name: duplicateObject.name,
              address: duplicateObject.address,
              matched_by: "adresse",
            };
          }
        }
        return {
          name: group.name,
          address: resolved.address,
          city: group.city,
          similar_object,
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
