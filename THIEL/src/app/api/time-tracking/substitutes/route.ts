import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type AssignedObject = { id: string; name: string; address: string };

/**
 * GET /api/time-tracking/substitutes – Vertretungen des angemeldeten Nutzers.
 *
 * Liefert alle GENEHMIGTEN Abwesenheiten, für die der angemeldete Nutzer als
 * Vertretung eingetragen ist, inkl. Name und Rolle der vertretenen Person
 * (Fahrer → orange, Reinigungskraft → lila im Kalender). Bei vertretenen
 * Reinigungskräften werden zusätzlich die zugewiesenen Objekte geliefert –
 * das sind die Objekte, die im Vertretungszeitraum gereinigt werden müssen.
 * Der Hinweis des Admins liegt in reviewer_note.
 */
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
    const [{ data: absenceRows, error: absenceError }, { data: objectRows, error: objectError }] = await Promise.all([
      supabase.from("time_off_requests").select("id, user_id, start_date, end_date, status").eq("status", "approved").is("substitute_id", null),
      supabase.from("objects").select("id, name").order("name"),
    ]);
    if (absenceError) throw absenceError;
    if (objectError) throw objectError;
    const { data: rows, error } = await supabase
      .from("time_off_requests")
      .select(
        "id, user_id, type, start_date, end_date, status, reviewer_note, substitute_request, substitute_kind, substitute_object_id",
      )
      .eq("substitute_id", auth.user.id)
      .in("status", ["approved", "pending"])
      .order("start_date", { ascending: false });
    if (error) throw error;

    const absentIds = [
      ...new Set((rows ?? []).map((row) => String(row.user_id))),
    ];

    // Name/Rolle der vertretenen Personen laden (für Farbe + Beschriftung).
    const profilesResult =
      absentIds.length > 0
        ? await supabase
            .from("profiles")
            .select("id, name, role")
            .in("id", absentIds)
        : { data: null, error: null };
    if (profilesResult.error) throw profilesResult.error;
    const profileById = new Map(
      (profilesResult.data ?? []).map((profile) => [
        String(profile.id),
        profile,
      ]),
    );

    // Zugewiesene Objekte der vertretenen Reinigungskräfte (nur dafür nötig).
    const cleanerIds = absentIds.filter(
      (id) => profileById.get(id)?.role === "facility_manager",
    );
    const objectsByUser = new Map<string, AssignedObject[]>();
    if (cleanerIds.length > 0) {
      const { data: assignments, error: assignmentError } = await supabase
        .from("object_assignments")
        .select("user_id, object_id, objects:object_id(id, name, address)")
        .in("user_id", cleanerIds);
      if (assignmentError) throw assignmentError;
      for (const assignment of assignments ?? []) {
        const userId = String(assignment.user_id);
        const object = Array.isArray(assignment.objects)
          ? assignment.objects[0]
          : assignment.objects;
        if (!object || typeof object !== "object") continue;
        const record = object as Record<string, unknown>;
        if (typeof record.id !== "string") continue;
        const list = objectsByUser.get(userId) ?? [];
        list.push({
          id: record.id,
          name: typeof record.name === "string" ? record.name : "Unbekanntes Objekt",
          address: typeof record.address === "string" ? record.address : "",
        });
        objectsByUser.set(userId, list);
      }
    }

    const substitutes = (rows ?? []).map((row) => {
      const absentId = String(row.user_id);
      const profile = profileById.get(absentId);
      return {
        id: String(row.id),
        start_date: String(row.start_date),
        end_date: String(row.end_date),
        type: row.type,
        status: row.status,
        substitute_request: row.substitute_request === true,
        substitute_kind: row.substitute_kind ?? null,
        /** Hinweis/Bemerkung des Admins zur Vertretung. */
        reviewer_note:
          typeof row.reviewer_note === "string" ? row.reviewer_note : null,
        absent: {
          id: absentId,
          name: profile?.name ?? "Unbekannter Mitarbeiter",
          role: profile?.role ?? "driver",
        },
        /** Nur bei vertretenen Reinigungskräften gefüllt. */
        objects: objectsByUser.get(absentId) ?? [],
      };
    });

    const absenceProfiles = await supabase.from("profiles").select("id, name, role").in("id", [...new Set((absenceRows ?? []).map((row) => String(row.user_id)))]);
    if (absenceProfiles.error) throw absenceProfiles.error;
    const absenceNames = new Map((absenceProfiles.data ?? []).map((profile) => [String(profile.id), profile]));
    const absences = (absenceRows ?? []).map((row) => ({ id: String(row.id), name: absenceNames.get(String(row.user_id))?.name ?? "Mitarbeiter", role: absenceNames.get(String(row.user_id))?.role ?? "driver", start_date: String(row.start_date), end_date: String(row.end_date) }));
    return NextResponse.json({ substitutes, absences, objects: objectRows ?? [] });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
