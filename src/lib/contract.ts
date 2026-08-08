/**
 * Vertragsarten & Soll/Ist-Berechnung (client-sicher, ohne Server-Imports).
 *
 * Jede Vertragsart hat eine maximale Wochenarbeitszeit (Vollzeit 40 h,
 * Teilzeit 20 h, Minijob 10 h). Die maximale Zeit wird bewusst nicht
 * angezeigt – sie steuert nur den automatischen Soll/Ist-Vergleich im
 * Überstundenkonto.
 *
 * `custom` = benutzerdefinierter Vertrag: Sollstunden/Arbeitstage/Urlaubstage
 * kommen aus dem Profil (weekly_target_hours, working_days_per_week,
 * vacation_days_per_year) statt aus festen Vertrags-Defaults.
 */

import { CONTRACT_TYPES, type ContractType } from "@/types/database";

export const CONTRACT_LABELS: Record<ContractType, string> = {
  full_time: "Vollzeit",
  part_time: "Teilzeit",
  mini_job: "Minijob",
  custom: "Individuell",
};

/** Maximale Wochenarbeitszeit je Vertragsart (Stunden). `custom` = Fallback. */
export const WEEKLY_HOURS_BY_CONTRACT: Record<ContractType, number> = {
  full_time: 40,
  part_time: 20,
  mini_job: 10,
  custom: 40,
};

/**
 * Auto-Fill-Werte je Vertragsart (Benutzer anlegen/bearbeiten). Beim
 * Auswählen einer Vertragsart werden diese Werte in die Eingabefelder
 * übernommen; `vacation_days_per_year` bleibt danach manuell anpassbar.
 */
export const CONTRACT_DEFAULTS: Record<
  ContractType,
  { weekly_target_hours: number; working_days_per_week: number; vacation_days_per_year: number }
> = {
  full_time: { weekly_target_hours: 40, working_days_per_week: 5, vacation_days_per_year: 30 },
  part_time: { weekly_target_hours: 20, working_days_per_week: 5, vacation_days_per_year: 30 },
  mini_job: { weekly_target_hours: 10, working_days_per_week: 2, vacation_days_per_year: 12 },
  custom: { weekly_target_hours: 40, working_days_per_week: 5, vacation_days_per_year: 30 },
};

/**
 * Vorschlagswert für den Jahresurlaub bei geänderten Arbeitstagen:
 * 30 Tage bei 5 Arbeitstagen/Woche, proportional (aufgerundet).
 */
export function vacationSuggestionFor(workingDaysPerWeek: number): number {
  if (!Number.isFinite(workingDaysPerWeek) || workingDaysPerWeek <= 0) return 0;
  return Math.round(30 * (workingDaysPerWeek / 5));
}

export function isContractType(value: unknown): value is ContractType {
  return (
    typeof value === "string" &&
    (CONTRACT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Soll-Arbeitszeit je Woche in Minuten.
 * - Liefert `weeklyTargetHours` (Profil, für `custom`), wenn gesetzt.
 * - Sonst Fallback auf die feste Wochenarbeitszeit der Vertragsart
 *   (bzw. Vollzeit 40 h bei unbekanntem Typ).
 */
export function weeklyMinutesForContract(
  contractType: ContractType | null | undefined,
  weeklyTargetHours: number | null | undefined = null,
): number {
  if (
    typeof weeklyTargetHours === "number" &&
    Number.isFinite(weeklyTargetHours) &&
    weeklyTargetHours > 0
  ) {
    return weeklyTargetHours * 60;
  }
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
  weeklyTargetHours: number | null | undefined = null,
  now = new Date(),
): number {
  const target = weeklyMinutesForContract(contractType, weeklyTargetHours);
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
  weeklyTargetHours: number | null | undefined = null,
  now = new Date(),
): number {
  return (
    Math.round((computeOvertimeBalanceMinutes(entries, contractType, weeklyTargetHours, now) / 60) * 100) / 100
  );
}
