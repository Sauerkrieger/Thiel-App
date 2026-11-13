import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

/**
 * Anzeige-Referenz auf ein Profil (Name/Rolle) für Zeit-Enträge/Anträge.
 */
export type ProfileRef = {
  name?: string;
  role?: string;
};

/**
 * Lädt ein id → {name, role}-Mapping für die angegebenen Nutzer-IDs.
 *
 * Wird verwendet, um Stempelungen und Anträgen den Mitarbeiternamen für die
 * Anzeige zuzuordnen, ohne eine PostgREST-Embedded-Relation zu benötigen:
 * `time_entries.user_id` referenziert `auth.users`, nicht `profiles` – ein
 * `profiles:user_id(...)`-Select scheitert deshalb mit "Could not find a
 * relationship between 'time_entries' and 'user_id'".
 */
export async function loadProfileRefs(
  userIds: string[],
): Promise<Map<string, ProfileRef>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  const map = new Map<string, ProfileRef>();
  if (unique.length === 0) return map;

  const { data, error } = await getSupabaseAdmin()
    .from("profiles")
    .select("id, name, role")
    .in("id", unique);
  if (error) throw error;

  for (const profile of data ?? []) {
    map.set(profile.id, { name: profile.name, role: profile.role });
  }
  return map;
}

/**
 * Hausputz: Markiert offene Stempelungen, die die 12-Stunden-Marke
 * überschritten ODER Mitternacht (00:00 Uhr, Europa/Berlin) erreicht haben,
 * als prüfbedürftig (`requires_review = true`, `is_approved = false`).
 *
 * Wird bei jedem Lese-/Schreib-Zugriff auf Zeitdaten aufgerufen, damit auch
 * Einträge erfasst werden, die „im Stillen“ überfällig geworden sind. Der
 * DB-Trigger (Migration 20260808000002) setzt die Flags zusätzlich direkt bei
 * Schreibvorgängen.
 */
export async function flagOverdueTimeEntries(
  supabase: SupabaseClient<Database>,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("flag_overdue_time_entries");
    if (error) {
      console.warn(
        "[Zeiterfassung] Housekeeping (überfällige Stempelungen) fehlgeschlagen:",
        error.message,
      );
    }
  } catch {
    // Hausputz ist optional – darf Lese-/Schreibpfade nie blockieren.
  }
}

/** Relevante Felder eines Zeit-Eintrags für den Audit-Snapshot. */
export type TimeEntryAuditSnapshot = {
  clock_in?: string | null;
  clock_out?: string | null;
  break_duration_minutes?: number | null;
  is_approved?: boolean | null;
  requires_review?: boolean | null;
  note?: string | null;
  source?: string | null;
};

/** Extrahiert die revisionsrelevanten Felder aus einer Zeit-Entry-Zeile. */
export function auditSnapshotOf(entry: {
  clock_in: string;
  clock_out: string | null;
  break_duration_minutes: number;
  is_approved: boolean;
  requires_review: boolean;
  note: string | null;
  source: string;
}): TimeEntryAuditSnapshot {
  return {
    clock_in: entry.clock_in,
    clock_out: entry.clock_out,
    break_duration_minutes: entry.break_duration_minutes,
    is_approved: entry.is_approved,
    requires_review: entry.requires_review,
    note: entry.note,
    source: entry.source,
  };
}

/**
 * Schreibt einen Eintrag ins revisionssichere Änderungsprotokoll
 * (time_entry_audit_logs). Best-Effort: Fehler blockieren nie den Hauptfluss.
 */
export async function logTimeEntryChange(
  supabase: SupabaseClient<Database>,
  params: {
    timeEntryId: string;
    changedByUserId: string;
    oldValues: TimeEntryAuditSnapshot | null;
    newValues: TimeEntryAuditSnapshot | null;
    changeReason: string;
  },
): Promise<void> {
  try {
    const { error } = await supabase.from("time_entry_audit_logs").insert({
      time_entry_id: params.timeEntryId,
      changed_by_user_id: params.changedByUserId,
      old_values: (params.oldValues ?? null) as Json | null,
      new_values: (params.newValues ?? null) as Json | null,
      change_reason: params.changeReason,
    });
    if (error) {
      console.warn(
        "[Zeiterfassung] Audit-Log konnte nicht geschrieben werden:",
        error.message,
      );
    }
  } catch (error) {
    console.warn(
      "[Zeiterfassung] Audit-Log konnte nicht geschrieben werden:",
      error,
    );
  }
}
