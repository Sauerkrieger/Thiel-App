/**
 * Gemeinsame, CLIENT-SICHERE Arbeitszeit-Berechnung und -Formatierung.
 *
 * Keine server-only-Imports – wird in ClockWidget, der Zeiterfassungs-Seite
 * und im Zeitadmin verwendet. Die Berechnung arbeitet mit absoluten
 * Zeitstempeln (Date.parse), dadurch sind auch Übernacht-Stempelungen
 * (z. B. 15:33 → 10:46 am Folgetag) exakt.
 */

export type ClockedEntryLike = {
  clock_in: string;
  clock_out: string | null;
  break_duration_minutes?: number | null;
};

/** Arbeitszeit eines abgeschlossenen Eintrags in Minuten (exakt, Übernacht-sicher). */
export function workedMinutesOf(entry: ClockedEntryLike): number {
  if (!entry.clock_out) return 0;
  const start = Date.parse(entry.clock_in);
  const end = Date.parse(entry.clock_out);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  const breakMinutes = Number(entry.break_duration_minutes ?? 0);
  return Math.max(0, (end - start) / 60000 - (Number.isFinite(breakMinutes) ? breakMinutes : 0));
}

/**
 * Gesetzliche Mindestpause nach § 4 ArbZG in Minuten, abhängig von der
 * Anwesenheitszeit (clock_out − clock_in):
 * - mehr als 6 bis 9 Stunden → 30 Minuten
 * - mehr als 9 Stunden → 45 Minuten
 */
export function requiredBreakMinutes(clockIn: string, clockOut: string): number {
  const start = Date.parse(clockIn);
  const end = Date.parse(clockOut);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  // Math.floor, damit die Grenzen exakt zum SQL-Trigger (floor(epoch/60)) passen.
  const presence = Math.floor((end - start) / 60000);
  if (presence > 9 * 60) return 45;
  if (presence > 6 * 60) return 30;
  return 0;
}

/**
 * Ergänzt die erfasste Pause auf die gesetzliche Mindestpause (§ 4 ArbZG).
 * Die Netto-Arbeitszeit bleibt (clock_out − clock_in) − Pause (workedMinutesOf).
 */
export function enforcedBreakMinutes(
  clockIn: string,
  clockOut: string,
  entered: number,
): number {
  return Math.max(Math.max(0, Math.round(entered)), requiredBreakMinutes(clockIn, clockOut));
}

/**
 * Minuten als echte Stunden & Minuten, z. B. 1153 → "19:13 h".
 * Ein negatives Vorzeichen bleibt erhalten (z. B. "-1:30 h").
 */
export function minutesToLabel(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `${sign}${hours}:${String(minutes).padStart(2, "0")} h`;
}

/** Dezimale Stunden (z. B. 19.5) als "19:30 h". */
export function hoursToLabel(hours: number): string {
  return minutesToLabel(hours * 60);
}
