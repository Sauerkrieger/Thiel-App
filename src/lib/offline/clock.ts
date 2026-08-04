/**
 * Clock-Skew-Mitigation (siehe OFFLINE_SYNC_PLAN.md).
 *
 * Nutzeruhren können lokal falsch gehen. Beim ersten Server-Kontakt wird daher
 *   timeOffset = serverTime - localClientTime
 * berechnet (RTT-Mittelwert) und in localStorage gecacht. `nowServerAligned()`
 * erzeugt damit `client_updated_at`-Zeitstempel, die serverseitig vergleichbar
 * bleiben – egal wie schief die Geräteuhr steht.
 */

const OFFSET_STORAGE_KEY = "thiel.clockOffsetMs";

let cachedOffset: number | null = null;
let fetched = false;
let offsetPromise: Promise<number> | null = null;

/** Gecachter Offset (0, wenn noch nie berechnet). Synchron, ohne Netz. */
export function getCachedTimeOffset(): number {
  if (cachedOffset !== null) return cachedOffset;
  if (typeof window === "undefined") return 0;
  const stored = window.localStorage.getItem(OFFSET_STORAGE_KEY);
  if (stored !== null) {
    const parsed = Number(stored);
    if (Number.isFinite(parsed)) {
      cachedOffset = parsed;
      return parsed;
    }
  }
  return 0;
}

/**
 * Stellt sicher, dass der Time-Offset berechnet ist. Wird nur einmal pro
 * Sitzung wirklich über das Netz geholt; schlägt der erste Versuch fehl
 * (offline), wird es beim nächsten Aufruf erneut versucht.
 */
export async function ensureTimeOffset(): Promise<number> {
  if (fetched) return getCachedTimeOffset();
  if (offsetPromise) return offsetPromise;

  offsetPromise = (async () => {
    try {
      const before = Date.now();
      const res = await fetch("/api/time", { cache: "no-store" });
      const after = Date.now();
      if (!res.ok) return 0;
      const body = (await res.json()) as { serverTime?: string };
      const serverMs = Date.parse(body.serverTime ?? "");
      if (Number.isNaN(serverMs)) return 0;
      const offset = serverMs - Math.round((before + after) / 2);
      cachedOffset = offset;
      fetched = true;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(OFFSET_STORAGE_KEY, String(offset));
      }
      return offset;
    } catch {
      return 0;
    } finally {
      offsetPromise = null;
    }
  })();

  return offsetPromise;
}

/** Aktueller Zeitpunkt als ISO-8601, auf die Serverzeit ausgerichtet. */
export function nowServerAligned(): string {
  return new Date(Date.now() + getCachedTimeOffset()).toISOString();
}
