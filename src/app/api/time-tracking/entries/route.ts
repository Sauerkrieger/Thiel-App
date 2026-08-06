import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser, isAdmin } from "@/lib/auth";
import { loadProfileRefs } from "@/lib/time-tracking";

export const dynamic = "force-dynamic";

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/;

/** GET /api/time-tracking/entries – eigene Stempelungen im Zeitraum. */
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if ((from && !ISO_DATE_TIME.test(from)) || (to && !ISO_DATE_TIME.test(to))) {
      return NextResponse.json({ error: "Ungültiger Zeitraum." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("time_entries")
      .select("*")
      .order("clock_in", { ascending: false });
    const requestedUserId = url.searchParams.get("user_id");
    if (!isAdmin(auth.user) || requestedUserId) {
      query = query.eq("user_id", isAdmin(auth.user) && requestedUserId ? requestedUserId : auth.user.id);
    }
    if (from) query = query.gte("clock_in", from);
    if (to) query = query.lte("clock_in", to);

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const userIds = rows
      .map((row) => row.user_id)
      .filter((id): id is string => typeof id === "string");
    const profileById = await loadProfileRefs(userIds);
    const entries = rows.map((row) => ({
      ...row,
      profiles: profileById.get(String(row.user_id)) ?? null,
    }));
    return NextResponse.json({ entries });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
