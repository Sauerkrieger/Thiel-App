/**
 * Unsichtbare Ladezeit-Messung für Item-Listen (Ausfahren/Tour, Packen,
 * Historie, Items-Dialog, Inventar, Planung). Erzeugt keine UI und ändert
 * kein Verhalten – sie liefert nur intern Messwerte (Dev-Konsole bei
 * auffälligen Werten), damit gezielt optimiert werden kann.
 *
 * Alle Helfer sind auf dem Server No-ops (kein window), damit SSR unberührt
 * bleibt. Bei schwachem Netz (`isSlowNetwork`) können Lade-Pfade den Cache
 * bevorzugen; die Messung dokumentiert die Quelle je Liste.
 */

type PerfSource = "cache" | "network" | "offline";

type PerfSample = {
  name: string;
  startedAt: number;
  /** ms bis zum ersten sichtbaren Datensatz (Cache-Stand) oder null. */
  timeToFirstDataMs: number | null;
  firstSource: PerfSource | null;
  /** ms bis zur vollständigen Liste (frische Daten). */
  durationMs: number | null;
  finalSource: PerfSource | null;
  count: number | null;
};

const samples = new Map<string, PerfSample>();

/** Schwellwert ab dem eine Messung in der Dev-Konsole landet (ms). */
const SLOW_THRESHOLD_MS = 1_000;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

function logSample(sample: PerfSample): void {
  if (process.env.NODE_ENV === "production") return;
  const duration = sample.durationMs ?? 0;
  const first = sample.timeToFirstDataMs ?? null;
  const net = networkType();
  console.info(
    `[perf] ${sample.name}: ${Math.round(duration)}ms` +
      (sample.finalSource ? ` (${sample.finalSource})` : "") +
      (first !== null ? `, erster Stand ${Math.round(first)}ms (${sample.firstSource})` : "") +
      (sample.count !== null ? `, ${sample.count} Zeilen` : "") +
      (net ? `, Netz ${net}` : ""),
  );
}

/**
 * Startet die Messung einer Liste. `name` identifiziert die Liste
 * (z. B. "tour-page", "delivery-dialog"); wiederholte Aufrufe überschreiben.
 */
export function startListPerf(name: string): void {
  if (typeof window === "undefined") return;
  samples.set(name, {
    name,
    startedAt: now(),
    timeToFirstDataMs: null,
    firstSource: null,
    durationMs: null,
    finalSource: null,
    count: null,
  });
}

/**
 * Erster sichtbarer Datensatz (z. B. sofortiger Cache-Stand). Nur der erste
 * Aufruf pro Messung zählt.
 */
export function markFirstData(
  name: string,
  source: PerfSource,
  count: number | null = null,
): void {
  const sample = samples.get(name);
  if (!sample) return;
  if (sample.timeToFirstDataMs !== null) return;
  sample.timeToFirstDataMs = now() - sample.startedAt;
  sample.firstSource = source;
  if (count !== null) sample.count = count;
}

/**
 * Beendet die Messung und loggt das Ergebnis bei auffälligen Werten
 * (nur Dev-Konsole; kein UI, keine Nutzerinteraktion).
 */
export function endListPerf(
  name: string,
  meta?: { source?: PerfSource; count?: number | null },
): void {
  const sample = samples.get(name);
  if (!sample) return;
  sample.durationMs = now() - sample.startedAt;
  if (meta?.source) sample.finalSource = meta.source;
  if (meta?.count !== undefined && meta.count !== null) sample.count = meta.count;
  if (sample.timeToFirstDataMs === null) {
    // Kein erster Stand protokolliert → Messung gilt als "komplett geladen".
    sample.timeToFirstDataMs = sample.durationMs;
    sample.firstSource = sample.finalSource ?? "network";
  }
  logSample(sample);
  samples.delete(name);
}

/* ------------------------------------------------------------------ */
/* Netzwerk-Qualität (schwaches Netz)                                  */
/* ------------------------------------------------------------------ */

/**
 * Effektiver Netzwerktyp über die Network-Information-API (Chrome/Edge):
 * 'slow-2g' | '2g' | '3g' | '4g' – null, wenn nicht verfügbar.
 */
export function networkType(): string | null {
  if (typeof navigator === "undefined") return null;
  const conn = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
    }
  ).connection;
  return conn?.effectiveType ?? null;
}

/** true bei schwachem Netz (2G/slow-2g oder Save-Data). */
export function isSlowNetwork(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
    }
  ).connection;
  return (
    conn?.effectiveType === "slow-2g" ||
    conn?.effectiveType === "2g" ||
    conn?.saveData === true
  );
}
