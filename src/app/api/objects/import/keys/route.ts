import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import {
  findDuplicate,
  normalizeAddress,
} from "@/lib/ocr";
import {
  normalizeAddressForGeocoding,
  orsGeocodeSearch,
} from "@/lib/ors";
import { safeIsInPedestrianZone } from "@/lib/overpass";
import { requireUser, isAdmin } from "@/lib/auth";
import type { KeyImportResult } from "@/types/api";

export const dynamic = "force-dynamic";

const MAX_KEYS = 500;

/** POST /api/objects/import/keys -> bestätigte Schlüssel-Zuordnungen übernehmen. */
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
      { error: "Nur Admins dürfen Schlüssel importieren." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const assignments = Array.isArray(body.assignments)
      ? (body.assignments as unknown[])
      : [];
    const rawNewObjects = Array.isArray(body.new_objects)
      ? (body.new_objects as unknown[])
      : [];

    if (assignments.length === 0 && rawNewObjects.length === 0) {
      return NextResponse.json(
        { error: "Keine Schlüssel-Zuordnungen übermittelt." },
        { status: 400 },
      );
    }
    if (assignments.length + rawNewObjects.length > MAX_KEYS) {
      return NextResponse.json(
        { error: `Maximal ${MAX_KEYS} Einträge erlaubt.` },
        { status: 400 },
      );
    }

    // Bestehende Zuordnungen validieren (Objekt + Schlüsselnummer)
    const parsed = assignments
      .map((a) => {
        if (typeof a !== "object" || a === null) return null;
        const raw = a as Record<string, unknown>;
        const keyNumber = Number(raw.key_number);
        return {
          object_id: typeof raw.object_id === "string" ? raw.object_id : "",
          key_number:
            Number.isInteger(keyNumber) && keyNumber > 0 ? keyNumber : null,
        };
      })
      .filter(
        (a): a is { object_id: string; key_number: number } =>
          a !== null && a.object_id.length > 0 && a.key_number !== null,
      );

    // Manuell angelegte Objekte (aus „Objekt nicht gefunden“-Einträgen)
    const newObjects: {
      name: string;
      address: string;
      key_number: number;
    }[] = [];
    for (const raw of rawNewObjects) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const address = typeof r.address === "string" ? r.address.trim() : "";
      const keyNumber = Number(r.key_number);
      if (!name || !address) continue;
      if (!(Number.isInteger(keyNumber) && keyNumber > 0)) continue;
      newObjects.push({ name, address, key_number: keyNumber });
    }

    if (parsed.length === 0 && newObjects.length === 0) {
      return NextResponse.json(
        { error: "Ungültige Schlüssel-Zuordnungen übermittelt." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    // Alle Objekte laden: für die Zuordnungs-Validierung und den
    // Duplikat-Check der manuell angelegten Objekte.
    const { data: allObjects, error: objectsError } = await supabase
      .from("objects")
      .select("id, name, address, key_number");
    if (objectsError) throw objectsError;
    const objects = allObjects ?? [];
    const existingById = new Map(objects.map((o) => [o.id, o]));
    const existingAddresses = objects.map((o) => normalizeAddress(o.address));
    const objectByAddress = new Map(
      objects.map((o) => [normalizeAddress(o.address), o]),
    );

    const result: KeyImportResult = {
      assigned: 0,
      already_had_key: 0,
      not_found: 0,
      new_objects_created: 0,
    };

    const toUpdate: {
      id: string;
      name: string;
      address: string;
      key_number: number;
    }[] = [];

    // 1) Bestehende Zuordnungen
    for (const p of parsed) {
      const obj = existingById.get(p.object_id);
      if (!obj) {
        result.not_found += 1;
      } else if (obj.key_number != null) {
        result.already_had_key += 1;
      } else {
        // Upsert benötigt die Pflichtfelder name/address – wir nutzen die
        // vorhandenen Werte, sodass nur key_number aktualisiert wird.
        toUpdate.push({
          id: obj.id,
          name: obj.name,
          address: obj.address,
          key_number: p.key_number,
        });
      }
    }

    // 2) Manuell angelegte Objekte (mit Duplikat-Erkennung über die Adresse)
    for (const n of newObjects) {
      const normalized = normalizeAddress(n.address);
      const duplicate = findDuplicate(normalized, existingAddresses);
      if (duplicate) {
        const dupObj = objectByAddress.get(duplicate);
        if (dupObj) {
          if (dupObj.key_number != null) {
            result.already_had_key += 1;
          } else {
            toUpdate.push({
              id: dupObj.id,
              name: dupObj.name,
              address: dupObj.address,
              key_number: n.key_number,
            });
          }
        }
        continue;
      }

      // Koordinaten per ORS-Geocoding ermitteln (wichtig für die Karte)
      let latitude: number | null = null;
      let longitude: number | null = null;
      const hit = await orsGeocodeSearch(
        normalizeAddressForGeocoding(n.address),
      );
      if (hit) {
        latitude = hit.latitude;
        longitude = hit.longitude;
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
          address: n.address,
          category: "objekt",
          is_pedestrian_zone_until_11: isPedestrianZone,
          opens_at: null,
          latitude,
          longitude,
          key_number: n.key_number,
        })
        .select("id, name, address, key_number")
        .single();
      if (error) throw error;

      result.new_objects_created += 1;
      existingAddresses.push(normalized);
      if (created) objectByAddress.set(normalized, created);
    }

    // Schlüsselnummern in Batches setzen (nur Objekte ohne vorhandene Nummer).
    for (let i = 0; i < toUpdate.length; i += 50) {
      const batch = toUpdate.slice(i, i + 50);
      const { error } = await supabase.from("objects").upsert(batch, {
        onConflict: "id",
      });
      if (error) throw error;
      result.assigned += batch.length;
    }

    return NextResponse.json(result);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
