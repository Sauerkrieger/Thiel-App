import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  apiErrorResponse,
  isObjectCategory,
  validLatitude,
  validLongitude,
} from "@/lib/http";
import { parseItemInputs } from "@/lib/items";
import { analyzeAddressCity, cleanAddressLabel, ensureAddressCity } from "@/lib/address";
import {
  findDuplicate,
  normalizeAddress,
  splitMultiHouseNumberAddress,
} from "@/lib/ocr";
import {
  normalizeAddressForGeocoding,
  orsGeocodeSearch,
  WUERZBURG_BOUNDARY,
} from "@/lib/ors";
import { safeIsInPedestrianZone } from "@/lib/overpass";
import { hasHouseNumber } from "@/lib/utils";
import { requireUser, isAdmin } from "@/lib/auth";
import type {
  ItemGroupImportNewObject,
  ItemGroupImportResult,
} from "@/types/api";

export const dynamic = "force-dynamic";

const MAX_GROUPS = 200;

/** Admin-Info (Kunde etc.) aus dem Body lesen – leere Werte werden null. */
function parseAdminInfo(r: Record<string, unknown>): {
  customer: string | null;
  customer_number: string | null;
  cleaning_interval: string | null;
} {
  const text = (value: unknown, max: number) =>
    typeof value === "string" && value.trim()
      ? value.trim().slice(0, max)
      : null;
  return {
    customer: text(r.customer, 200),
    customer_number: text(r.customer_number, 100),
    cleaning_interval: text(r.cleaning_interval, 100),
  };
}

/** POST /api/objects/import/items -> bestätigte Items-Gruppen übernehmen. */
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
    const body = await request.json().catch(() => ({}));
    // Dieser Import darf ausschließlich neue Objekte anlegen. Ein früheres
    // Payload-Feld `groups` wird bewusst ignoriert, damit ältere Clients
    // niemals wieder bestehende Objekte mit Items verändern können.
    const rawNewObjects = Array.isArray(body.new_objects)
      ? (body.new_objects as unknown[])
      : [];

    if (rawNewObjects.length === 0) {
      return NextResponse.json(
        { error: "Keine Items-Gruppen übermittelt." },
        { status: 400 },
      );
    }
    if (rawNewObjects.length > MAX_GROUPS) {
      return NextResponse.json(
        { error: `Maximal ${MAX_GROUPS} Gruppen erlaubt.` },
        { status: 400 },
      );
    }

    // Neu anzulegende Objekte aus der bestätigten Vorschau.
    // Eine exakte Adresse mit Hausnummer ist Pflicht – reine Straßen- oder
    // Ortsangaben werden abgelehnt.
    const newObjects: ItemGroupImportNewObject[] = [];
    for (const raw of rawNewObjects) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const address = typeof r.address === "string" ? r.address.trim() : "";
      const items = parseItemInputs(r.items);
      if (!name || !items || items.length === 0) continue;
      if (!hasHouseNumber(address)) continue;
      // Mehrfach-Hausnummern derselben Straße (Treppenhaus-Fall, z. B.
      // „Josefplatz 1,2,3“): Nur die ERSTE Hausnummer wird als Adresse
      // gespeichert/geocodiert – der Gesamtstring („Josefplatz 1,2,3,
      // Würzburg“) führt bei ORS sonst zu einem falschen Treffer (z. B.
      // Düsseldorf). Der Name behält die vollständige Adressliste.
      const split = splitMultiHouseNumberAddress(address);
      const geoAddress = split ? split.first : address;
      newObjects.push({
        name,
        // Würzburg-Regel: Ohne Ortsangabe wird „Würzburg“ ergänzt, damit die
        // Adresse nie ohne Städtezusatz gespeichert wird (sonst landet sie
        // beim Geocoding irgendwo in Deutschland).
        address: ensureAddressCity(geoAddress),
        latitude: validLatitude(r.latitude),
        longitude: validLongitude(r.longitude),
        category: isObjectCategory(r.category) ? r.category : "objekt",
        ...parseAdminInfo(r),
        items,
      });
    }

    if (newObjects.length === 0) {
      return NextResponse.json(
        { error: "Ungültige Items-Gruppen übermittelt." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    // Nur für die Warnstatistik laden. Die Treffer werden niemals als
    // Zielobjekt für Items verwendet.
    const { data: allObjects, error: allObjectsError } = await supabase
      .from("objects")
      .select("address");
    if (allObjectsError) throw allObjectsError;
    const existingAddresses = (allObjects ?? []).map((o) =>
      normalizeAddress(o.address),
    );
    const result: ItemGroupImportResult = {
      assigned: 0,
      items_added: 0,
      not_found: 0,
      new_objects_created: 0,
      new_objects_skipped: 0,
      duplicate_warnings: 0,
    };

    const toInsert: {
      object_id: string;
      item_name: string;
      quantity: number;
      note: string | null;
      is_always_required: boolean;
      is_reserved: boolean;
    }[] = [];

    // Neue Objekte anlegen. Ähnliche Bestandsobjekte werden nur gezählt
    // und gemeldet; sie dürfen den Import niemals in eine Bestandsänderung
    // oder Zuordnung umwandeln.
    for (const n of newObjects) {
      const finalAddress = cleanAddressLabel(n.address);
      const normalized = normalizeAddress(finalAddress);
      if (findDuplicate(normalized, existingAddresses)) {
        result.duplicate_warnings += 1;
      }

      // Koordinaten aus der Vorschau übernehmen; falls sie fehlen (kein ORS-
      // Treffer oder Adresse manuell geändert), nach-geocoden.
      let latitude = n.latitude;
      let longitude = n.longitude;
      if (latitude === null || longitude === null) {
        // Würzburg-Regel: Nennt die Adresse explizit eine andere Stadt
        // (z. B. Ochsenfurt), wird ohne Begrenzung gesucht. Sonst – inklusive
        // fehlender Ortsangabe (wird als Würzburg behandelt) – wird die Suche
        // auf das Würzburger Stadtgebiet begrenzt.
        const city = analyzeAddressCity(finalAddress);
        const boundary =
          city.hasCity && !city.isWuerzburg ? undefined : WUERZBURG_BOUNDARY;
        const hit = await orsGeocodeSearch(
          normalizeAddressForGeocoding(finalAddress),
          { boundary },
        );
        if (hit) {
          latitude = hit.latitude;
          longitude = hit.longitude;
        }
      }

      // Fußgängerzone automatisch anhand der Koordinaten erkennen
      const isPedestrianZone = await safeIsInPedestrianZone(
        latitude,
        longitude,
      );

      const { data: created, error } = await supabase
        .from("objects")
        .insert({
          name: n.name,
          address: finalAddress,
          category: n.category,
          is_pedestrian_zone_until_11: isPedestrianZone,
          opens_at: null,
          latitude,
          longitude,
          customer: n.customer,
          customer_number: n.customer_number,
          cleaning_interval: n.cleaning_interval,
        })
        .select("id, name, address")
        .single();
      if (error) {
        result.new_objects_skipped += 1;
        continue;
      }

      result.new_objects_created += 1;
      existingAddresses.push(normalized);
      for (const item of n.items) {
        toInsert.push({
          object_id: created.id,
          item_name: item.item_name,
          quantity: item.quantity,
          note: item.note,
          is_always_required: item.is_always_required,
          is_reserved: false,
        });
      }
      result.assigned += 1;
    }

    // Items in Batches einfügen.
    for (let i = 0; i < toInsert.length; i += 100) {
      const batch = toInsert.slice(i, i + 100);
      const { error } = await supabase.from("object_items").insert(batch);
      if (error) throw error;
      result.items_added += batch.length;
    }

    return NextResponse.json(result);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
