import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireUser, isAdmin } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** GET /api/admin/time-tracking/export – Lohn-CSV für Admins. */
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Nur Admins dürfen CSV-Exporte erstellen." }, { status: 403 });

  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("time_entries")
      .select("id, user_id, clock_in, clock_out, break_duration_minutes, note, is_approved, profiles:user_id(name, role)")
      .order("clock_in", { ascending: true });
    if (from) query = query.gte("clock_in", from);
    if (to) query = query.lte("clock_in", to);
    const { data, error } = await query;
    if (error) throw error;
    type ExportEntry = {
      user_id: string;
      clock_in: string;
      clock_out: string | null;
      break_duration_minutes: number;
      note: string | null;
      is_approved: boolean;
      profiles: { name: string; role: string } | { name: string; role: string }[] | null;
    };
    const exportEntries = (data ?? []) as unknown as ExportEntry[];

    const rows = [
      ["Mitarbeiter", "Rolle", "Von", "Bis", "Pause (Min)", "Arbeitszeit (h)", "Freigegeben", "Bemerkung"],
      ...exportEntries.map((entry) => {
        const profile = Array.isArray(entry.profiles) ? entry.profiles[0] : entry.profiles;
        const start = new Date(entry.clock_in).getTime();
        const end = entry.clock_out ? new Date(entry.clock_out).getTime() : start;
        const hours = entry.clock_out
          ? Math.max(0, (end - start) / 3_600_000 - Number(entry.break_duration_minutes ?? 0) / 60)
          : null;
        return [
          profile?.name ?? entry.user_id,
          profile?.role ?? "",
          entry.clock_in,
          entry.clock_out ?? "",
          entry.break_duration_minutes,
          hours === null ? "offen" : hours.toFixed(2),
          entry.is_approved ? "ja" : "nein",
          entry.note ?? "",
        ];
      }),
    ];
    const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="zeiterfassung-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
