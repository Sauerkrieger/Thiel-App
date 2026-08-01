/**
 * Reine Zeit-Helfer & Vorbereitungs-Konstanten für die Tourenplanung.
 * Bewusst ohne Server-Abhängigkeiten, damit sie auch im Client nutzbar sind.
 */

/** Packzeit am Lager pro Stopp/Objekt vor Abfahrt. */
export const PREP_MINUTES_PER_STOP = 5;
/** Einmalige Zeit am Lager zum Einsammeln der Schlüssel. */
export const KEY_COLLECTION_MINUTES = 5;

/** Vorbereitungszeit für eine Tour mit `count` Stopps (5 Min/Stopp + 5 Min Schlüssel). */
export function prepMinutesForCount(count: number): number {
  return count * PREP_MINUTES_PER_STOP + KEY_COLLECTION_MINUTES;
}

/** "HH:MM" → Minuten seit 0 Uhr. */
export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map((p) => Number.parseInt(p, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/** Minuten seit 0 Uhr → "HH:MM" (24h-Umlauf, auch für negative Werte). */
export function formatMinutes(minutes: number): string {
  const total = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Standard-Startzeit: aktuelle Uhrzeit + Vorbereitungszeit,
 * auf die nächsten 5 Minuten aufgerundet ("HH:MM").
 */
export function defaultStartTime(prepMinutes: number, now = new Date()): string {
  const minutes = now.getHours() * 60 + now.getMinutes() + prepMinutes;
  const rounded = Math.ceil(minutes / 5) * 5;
  return formatMinutes(rounded);
}

/** Minuten → lesbare Dauer, z. B. "7 Std. 38 Min." (unter 60 Min: "45 Min."). */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} Min.`;
  if (m === 0) return `${h} Std.`;
  return `${h} Std. ${m} Min.`;
}
