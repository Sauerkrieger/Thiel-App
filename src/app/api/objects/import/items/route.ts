import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  apiErrorResponse,
  isObjectCategory,
  validLatitude,
  validLongitude,
} from "@/lib/http";
import { parseItemInputs, type ItemInput } from "@/lib/items";
import { cleanAddressLabel } from "@/lib/address";
import { findDuplicate, normalizeAddress } from "@/lib/ocr";
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
    const groups = Array.isArray(body.groups) ? (body.groups as unknown[]) : [];
    const rawNewObjects = Array.isArray(body.new_objects)
      ? (body.new_objects as unknown[])
      : [];

    if (groups.length === 0 && rawNewObjects.length === 0) {
      return NextResponse.json(
        { error: "Keine Items-Gruppen übermittelt." },
        { status: 400 },
      );
    }
    if (groups.length + rawNewObjects.length > MAX_GROUPS) {
      return NextResponse.json(
        { error: `Maximal ${MAX_GROUPS} Gruppen erlaubt.` },
        { status: 400 },
      );
    }

    const parsed = groups
      .map((g) => {
        if (typeof g !== "object" || g === null) return null;
        const raw = g as Record<string, unknown>;
        const objectId = typeof raw.object_id === "string" ? raw.object_id : "";
        const items = parseItemInputs(raw.items);
        if (!objectId || !items || items.length === 0) return null;
        return { object_id: objectId, items, ...parseAdminInfo(raw) };
      })
      .filter(
        (g): g is {
          object_id: string;
          items: ItemInput[];
          customer: string | null;
          customer_number: string | null;
          cleaning_interval: string | null;
        } => g !== null,
      );

    // Neu anzulegende Objekte (aus „Objekt nicht gefunden“-Einträgen).
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
      newObjects.push({
        name,
        address,
        latitude: validLatitude(r.latitude),
        longitude: validLongitude(r.longitude),
        category: isObjectCategory(r.category) ? r.category : "objekt",
        ...parseAdminInfo(r),
        items,
      });
    }

    if (parsed.length === 0 && newObjects.length === 0) {
      return NextResponse.json(
        { error: "Ungültige Items-Gruppen übermittelt." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    // Existierende Objekte laden: für die Zuordnungs-Validierung und den
    // Duplikat-Check der neu anzulegenden Objekte.
    const ids = parsed.map((p) => p.object_id);
    const { data: existing, error: existingError } = await supabase
      .from("objects")
      .select("id")
      .in("id", ids);
    if (existingError) throw existingError;
    const existingIds = new Set((existing ?? []).map((o) => o.id));

    const { data: allObjects, error: allObjectsError } = await supabase
      .from("objects")
      .select("id, name, address");
    if (allObjectsError) throw allObjectsError;
    const existingAddresses = (allObjects ?? []).map((o) =>
      normalizeAddress(o.address),
    );
    const objectByAddress = new Map(
      (allObjects ?? []).map((o) => [normalizeAddress(o.address), o]),
    );

    const result: ItemGroupImportResult = {
      assigned: 0,
      items_added: 0,
      not_found: 0,
      new_objects_created: 0,
      new_objects_skipped: 0,
    };

    const toInsert: {
      object_id: string;
      item_name: string;
      quantity: number;
      note: string | null;
      is_always_required: boolean;
    }[] = [];

    // 1) Bestehende Objekte
    for (const p of parsed) {
      if (!existingIds.has(p.object_id)) {
        result.not_found += 1;
        continue;
      }
      for (const item of p.items) {
        toInsert.push({
          object_id: p.object_id,
          item_name: item.item_name,
          quantity: item.quantity,
          note: item.note,
          is_always_required: item.is_always_required,
        });
      }
      result.assigned += 1;
    }

    // 2) Neue Objekte anlegen (mit Duplikat-Erkennung über die Adresse)
    for (const n of newObjects) {
      const normalized = normalizeAddress(n.address);
      const duplicate = findDuplicate(normalized, existingAddresses);
      if (duplicate) {
        // Adresse existiert bereits → Items dem vorhandenen Objekt zuordnen,
        // statt ein Duplikat anzulegen.
        const dupObj = objectByAddress.get(duplicate);
        if (dupObj) {
          for (const item of n.items) {
            toInsert.push({
              object_id: dupObj.id,
              item_name: item.item_name,
              quantity: item.quantity,
              note: item.note,
              is_always_required: item.is_always_required,
            });
          }
          result.assigned += 1;
        } else {
          result.new_objects_skipped += 1;
        }
        continue;
      }

      // Koordinaten aus der Vorschau übernehmen; falls sie fehlen (kein ORS-
      // Treffer oder Adresse manuell geändert), nach-geocoden.
      let latitude = n.latitude;
      let longitude = n.longitude;
      if (latitude === null || longitude === null) {
        // Ohne PLZ/Ort im Zettel wird die Adresse in Würzburg vermutet –
        // die Suche wird dann auf das Würzburger Stadtgebiet begrenzt.
        const boundary = /\b\d{5}\b/.test(n.address)
          ? undefined
          : WUERZBURG_BOUNDARY;
        const hit = await orsGeocodeSearch(
          normalizeAddressForGeocoding(n.address),
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
          address: cleanAddressLabel(n.address),
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
      objectByAddress.set(normalized, created);

      for (const item of n.items) {
        toInsert.push({
          object_id: created.id,
          item_name: item.item_name,
          quantity: item.quantity,
          note: item.note,
          is_always_required: item.is_always_required,
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

    // 3) Erkannte Admin-Infos (Kunde, Kundennummer, Reinigungsturnus) an
    //    bestehende Objekte schreiben – nur gesetzte Werte überschreiben.
    for (const p of parsed) {
      if (!existingIds.has(p.object_id)) continue;
      const update: {
        customer?: string;
        customer_number?: string;
        cleaning_interval?: string;
      } = {};
      if (p.customer !== null) update.customer = p.customer;
      if (p.customer_number !== null)
        update.customer_number = p.customer_number;
      if (p.cleaning_interval !== null)
        update.cleaning_interval = p.cleaning_interval;
      if (Object.keys(update).length === 0) continue;
      const { error } = await supabase
        .from("objects")
        .update(update)
        .eq("id", p.object_id);
      if (error) throw error;
    }

    return NextResponse.json(result);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
