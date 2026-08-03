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

type Context = { params: Promise<{ id: string }> };

/** Parst die optionale Schlüssel-Nummer (positive Ganzzahl oder null). */
function parseKeyNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(_request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    // Admin-Info (Kunde, Kundennummer, Reinigungsturnus) nur für Admins.
    const select = isAdmin(auth.user)
      ? "*, object_items(id, item_name, quantity, note, photo_path, is_always_required, created_at)"
      : "id, name, address, latitude, longitude, category, is_pedestrian_zone_until_11, key_number, opens_at, created_at, updated_at, object_items(id, item_name, quantity, note, photo_path, is_always_required, created_at)";
    const { data, error } = await supabase
      .from("objects")
      .select(select)
      .eq("id", id)
      .single();

    if (error) {
      // PGRST116 = keine Zeile gefunden
      if (error.code === "PGRST116") {
        return NextResponse.json(
          { error: "Objekt nicht gefunden." },
          { status: 404 },
        );
      }
      throw error;
    }
    return NextResponse.json({ object: data });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

export async function PUT(request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  if (!isAdmin(auth.user)) {
    return NextResponse.json(
      { error: "Nur Admins dürfen Objekte bearbeiten." },
      { status: 403 },
    );
  }

  try {
    const { id } = await params;
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
      .update({
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
      .eq("id", id)
      .select()
      .single();

    if (error) {
      // PGRST116 = keine Zeile gefunden
      if (error.code === "PGRST116") {
        return NextResponse.json(
          { error: "Objekt nicht gefunden." },
          { status: 404 },
        );
      }
      throw error;
    }

    // Items ersetzen: bestehende löschen, neue anlegen
    const { error: deleteError } = await supabase
      .from("object_items")
      .delete()
      .eq("object_id", id);
    if (deleteError) throw deleteError;

    if (items.length > 0) {
      const { error: insertError } = await supabase.from("object_items").insert(
        items.map((item) => ({
          object_id: id,
          item_name: item.item_name,
          quantity: item.quantity,
          note: item.note,
          photo_path: item.photo_path,
          is_always_required: item.is_always_required,
        })),
      );
      if (insertError) throw insertError;
    }

    return NextResponse.json({ object: data });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  if (!isAdmin(auth.user)) {
    return NextResponse.json(
      { error: "Nur Admins dürfen Objekte löschen." },
      { status: 403 },
    );
  }

  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("objects").delete().eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
