import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  apiErrorResponse,
  isObjectCategory,
  validLatitude,
  validLongitude,
} from "@/lib/http";
import { parseItemInputs } from "@/lib/items";
import { safeIsInPedestrianZone } from "@/lib/overpass";
import { requireUser, isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Parst die optionale Schlüssel-Nummer (positive Ganzzahl oder null). */
function parseKeyNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    // Admin-Info (Kunde, Kundennummer, Reinigungsturnus) nur für Admins.
    const select = isAdmin(auth.user)
      ? "*, object_items(id, item_name, quantity, note, photo_path, is_always_required, created_at)"
      : "id, name, address, latitude, longitude, category, is_pedestrian_zone_until_11, key_number, opens_at, created_at, updated_at, object_items(id, item_name, quantity, note, photo_path, is_always_required, created_at)";
    const { data, error } = await supabase
      .from("objects")
      .select(select)
      .order("name");

    if (error) throw error;
    return NextResponse.json({ objects: data });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  // Nur Admins dürfen Objekte anlegen.
  if (!isAdmin(auth.user)) {
    return NextResponse.json(
      { error: "Nur Admins dürfen Objekte anlegen." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const latitude = validLatitude(body.latitude);
    const longitude = validLongitude(body.longitude);

    if (!name || !address) {
      return NextResponse.json(
        { error: "Name und Adresse sind Pflichtfelder." },
        { status: 400 },
      );
    }

    // Fehlendes/null items-Feld = keine Items (nicht mit übertragen = leere Liste)
    const items = body.items == null ? [] : parseItemInputs(body.items);
    if (items === null) {
      return NextResponse.json(
        { error: "Ungültige Items übermittelt (Menge/Bezeichnung/Bemerkung prüfen)." },
        { status: 400 },
      );
    }

    // Fußgängerzone automatisch anhand der Koordinaten erkennen
    const isPedestrianZone = await safeIsInPedestrianZone(latitude, longitude);

    const text = (value: unknown, max: number) =>
      typeof value === "string" && value.trim()
        ? value.trim().slice(0, max)
        : null;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("objects")
      .insert({
        name,
        address,
        latitude,
        longitude,
        category: isObjectCategory(body.category) ? body.category : "objekt",
        is_pedestrian_zone_until_11: isPedestrianZone,
        key_number: parseKeyNumber(body.key_number),
        opens_at:
          typeof body.opens_at === "string" && body.opens_at
            ? body.opens_at
            : null,
        customer: text(body.customer, 200),
        customer_number: text(body.customer_number, 100),
        cleaning_interval: text(body.cleaning_interval, 100),
      })
      .select()
      .single();

    if (error) throw error;

    if (items.length > 0) {
      const { error: itemsError } = await supabase.from("object_items").insert(
        items.map((item) => ({
          object_id: data.id,
          item_name: item.item_name,
          quantity: item.quantity,
          note: item.note,
          photo_path: item.photo_path,
          is_always_required: item.is_always_required,
        })),
      );
      if (itemsError) {
        // Objekt aufräumen, wenn das Anlegen der Items fehlschlägt
        await supabase.from("objects").delete().eq("id", data.id);
        throw itemsError;
      }
    }

    return NextResponse.json({ object: data }, { status: 201 });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
