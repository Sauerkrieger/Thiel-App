import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import {
  applyLww,
  ownsTourStop,
  ownsUserScopedRecord,
  prepareSyncEntry,
  type PreparedSyncEntry,
} from "@/lib/lww";

export const dynamic = "force-dynamic";

const MAX_ENTRIES = 200;

type SyncResultItem = {
  table: string;
  id: string;
  applied?: boolean;
  serverRecord?: Record<string, unknown>;
  error?: string;
};

function readableError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Sync-Fehler";
}

/**
 * POST /api/sync – Batch-Sync mit Last-Write-Wins.
 *
 * Body:
 *   { "entries": [
 *       { "table": "objects", "id": "…", "client_updated_at": "ISO", "data": {…} },
 *       …
 *     ] }
 *
 * Antwort:
 *   { "results": [
 *       { "table": "objects", "id": "…", "applied": true },
 *       { "table": "objects", "id": "…", "applied": false, "serverRecord": {…} },
 *       { "table": "objects", "id": "…", "error": "…" }
 *     ] }
 *
 * `applied: false` bedeutet LWW-Konflikt (Server-Zustand ist neuer/identisch)
 * → der Client soll `serverRecord` lokal übernehmen.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const rawEntries = body.entries;

    if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
      return NextResponse.json(
        { error: "Keine Sync-Einträge übermittelt." },
        { status: 400 },
      );
    }
    if (rawEntries.length > MAX_ENTRIES) {
      return NextResponse.json(
        { error: `Zu viele Einträge (max. ${MAX_ENTRIES}).` },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const results: SyncResultItem[] = [];

    for (const raw of rawEntries) {
      const entry =
        raw && typeof raw === "object"
          ? (raw as Record<string, unknown>)
          : {};

      const preparedResult = prepareSyncEntry(auth.user, entry);
      if (!preparedResult.ok) {
        results.push({
          table: typeof entry.table === "string" ? entry.table : "?",
          id: typeof entry.id === "string" ? entry.id : "?",
          error: preparedResult.error,
        });
        continue;
      }
      const prepared: PreparedSyncEntry = preparedResult.prepared;

      try {
        // Zeit-/Abwesenheitsdaten: bestehende Datensätze dürfen nur vom
        // Eigentümer (oder Admin) synchronisiert werden.
        if (
          prepared.table === "time_entries" ||
          prepared.table === "time_off_requests"
        ) {
          const ownership = await ownsUserScopedRecord(
            supabase,
            auth.user,
            prepared.table,
            prepared.id,
          );
          if (!ownership.ok) {
            results.push({ table: prepared.table, id: prepared.id, error: ownership.error });
            continue;
          }
        }

        // tour_stops: Zugehörigkeit zur eigenen Tour prüfen (außer Admin)
        if (prepared.table === "tour_stops") {
          const ownership = await ownsTourStop(supabase, auth.user, prepared.data);
          if (!ownership.ok) {
            results.push({ table: prepared.table, id: prepared.id, error: ownership.error });
            continue;
          }
        }

        const outcome = await applyLww(
          supabase,
          prepared.table,
          prepared.id,
          prepared.client_updated_at,
          prepared.data,
        );

        // serverRecord immer mitsenden: Der Client übernimmt ihn als
        // Quelle der Wahrheit (inkl. evtl. abweichender Server-Id, z. B.
        // weekly_default_routes über den natürlichen Schlüssel).
        results.push({
          table: prepared.table,
          id: prepared.id,
          applied: outcome.applied,
          serverRecord: outcome.applied ? outcome.record : outcome.serverRecord,
        });
      } catch (e) {
        results.push({
          table: prepared.table,
          id: prepared.id,
          error: readableError(e),
        });
      }
    }

    return NextResponse.json({ results });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
