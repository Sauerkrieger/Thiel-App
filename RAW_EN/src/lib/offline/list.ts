/**
 * Einheitliches Laden von Listen.
 *
 * Regel: Es werden **immer zuerst die aktuellen Daten vom Server** geholt.
 * Der Offline-Cache wird nur dann angezeigt, wenn das Netz nicht antwortet –
 * und dann mit Zeitstempel gekennzeichnet. Dadurch erscheint nie ein alter
 * Stand als „aktuell“ (vorher: Cache sofort, Netz danach).
 */

import type { ApiError } from "@/types/api";
import { offlineFetch, offlineReadCachedWithMeta } from "./fetch";

export type ListLoad<T> = {
  data: T | null;
  /** ISO-Zeitstempel des angezeigten Cache-Stands (nur bei Offline-Fallback). */
  offlineSince: string | null;
  error: ApiError | null;
  /** HTTP-Status des Server-Antworts (null bei Netzwerkfehler/Cache-Fallback). */
  status: number | null;
};

/**
 * Lädt eine Listen-URL und parst die Antwort. Schlägt der Request fehl
 * (Netzwerkfehler, 5xx), wird der letzte Cache-Stand als Fallback geliefert.
 * 4xx (Rechte, Login) sind echte Fehler und fallen **nicht** auf den Cache
 * zurück – sonst sähe ein Berechtigungsproblem wie „alte Daten“ aus.
 */
export async function loadList<T>(
  url: string,
  parse: (body: Record<string, unknown>) => T,
): Promise<ListLoad<T>> {
  const fromCache = async (
    error: ApiError | null,
    status: number | null = null,
  ): Promise<ListLoad<T>> => {
    const cached = await offlineReadCachedWithMeta(url);
    if (cached) {
      return {
        data: parse(cached.data),
        offlineSince: cached.cachedAt,
        error: null,
        status,
      };
    }
    return { data: null, offlineSince: null, error, status };
  };

  let res: Response;
  try {
    res = await offlineFetch(url, { cache: "no-store" });
  } catch {
    return fromCache({
      message: "Network error – no connection to the server.",
    });
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error: ApiError = {
      code: typeof body.code === "string" ? body.code : undefined,
      message:
        typeof body.error === "string" ? body.error : "Unknown error",
    };
    if (res.status >= 400 && res.status < 500) {
      return { data: null, offlineSince: null, error, status: res.status };
    }
    return fromCache(error, res.status);
  }

  // Antwort kam aus dem Offline-Cache (offline oder Netz weggebrochen): dann
  // mit Zeitstempel kennzeichnen, damit sie nicht als „aktuell“ gilt.
  const servedFromCache = Boolean(
    (res as unknown as { fromCache?: boolean }).fromCache,
  );
  const parsed = parse(body);
  if (!servedFromCache) {
    return { data: parsed, offlineSince: null, error: null, status: res.status };
  }
  const cached = await offlineReadCachedWithMeta(url);
  return {
    data: parsed,
    offlineSince: cached?.cachedAt ?? null,
    error: null,
    status: res.status,
  };
}
