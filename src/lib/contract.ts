/**
 * Vertragsarten & Soll/Ist-Berechnung (client-sicher, ohne Server-Imports).
 *
 * Jede Vertragsart hat eine maximale Wochenarbeitszeit (Vollzeit 40 h,
 * Teilzeit 20 h, Minijob 10 h). Die maximale Zeit wird bewusst nicht
 * angezeigt – sie steuert nur den automatischen Soll/Ist-Vergleich im
 * Überstundenkonto.
 */

import { CONTRACT_TYPES, type ContractType } from "@/types/database";

export const CONTRACT_LABELS: Record<ContractType, string> = {
  full_time: "Vollzeit",
  part_time: "Teilzeit",
  mini_job: "Minijob",
};

/** Maximale Wochenarbeitszeit je Vertragsart (Stunden). */
export const WEEKLY_HOURS_BY_CONTRACT: Record<ContractType, number> = {
  full_time: 40,
  part_time: 20,
  mini_job: 10,
};

export function isContractType(value: unknown): value is ContractType {
  return (
    typeof value === "string" &&
    (CONTRACT_TYPES as readonly string[]).includes(value)
  );
}

/** Soll-Arbeitszeit je Woche in Minuten (Fallback: Vollzeit 40 h). */
export function weeklyMinutesForContract(
  contractType: ContractType | null | undefined,
): number {
  const type = isContractType(contractType) ? contractType : "full_time";
  return WEEKLY_HOURS_BY_CONTRACT[type] * 60;
}

/** Montag 00:00 der ISO-Woche des Datums (Ortszeit). */
function isoWeekStart(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay() || 7; // 1 = Montag ... 7 = Sonntag
  result.setDate(result.getDate() - day + 1);
  return result;
}

export type OvertimeEntryLike = {
  clock_in: string;
  clock_out: string | null;
  break_duration_minutes?: number | null;
  is_approved?: boolean | null;
};

/**
 * Automatisches Überstundenkonto in Minuten (kann negativ sein = Minusstunden).
 *
 * Summiert pro abgeschlossener ISO-Woche die Differenz aus tatsächlicher
 * Arbeitszeit (Ist, nur freigegebene, abgeschlossene Einträge) und
 * Soll-Arbeitszeit der Vertragsart. Laufende Wochen zählen erst, wenn sie
 * vollständig vorbei sind – so schwankt das Konto nicht im Tagesverlauf.
 */
export function computeOvertimeBalanceMinutes(
  entries: OvertimeEntryLike[],
  contractType: ContractType | null | undefined,
  now = new Date(),
): number {
  const target = weeklyMinutesForContract(contractType);
  const currentWeekStart = isoWeekStart(now).getTime();
  const byWeek = new Map<number, number>();

  for (const entry of entries) {
    if (entry.is_approved === false || !entry.clock_out) continue;
    const startMs = Date.parse(entry.clock_in);
    const endMs = Date.parse(entry.clock_out);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
    const weekStart = isoWeekStart(new Date(startMs)).getTime();
    if (weekStart >= currentWeekStart) continue; // laufende Woche noch nicht zählen
    const breakMinutes = Number(entry.break_duration_minutes ?? 0);
    const minutes = Math.max(
      0,
      (endMs - startMs) / 60000 -
        (Number.isFinite(breakMinutes) ? breakMinutes : 0),
    );
    byWeek.set(weekStart, (byWeek.get(weekStart) ?? 0) + minutes);
  }

  let balance = 0;
  for (const minutes of byWeek.values()) balance += minutes - target;
  return Math.round(balance);
}

/** Automatisches Überstundenkonto in Stunden (2 Dezimalstellen). */
export function overtimeBalanceHours(
  entries: OvertimeEntryLike[],
  contractType: ContractType | null | undefined,
  now = new Date(),
): number {
  return (
    Math.round((computeOvertimeBalanceMinutes(entries, contractType, now) / 60) * 100) / 100
  );
}
