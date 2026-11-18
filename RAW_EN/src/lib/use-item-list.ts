"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadList } from "@/lib/offline/list";
import { endListPerf, startListPerf } from "@/lib/perf";
import type { ApiError } from "@/types/api";

export type ItemListState<T> = {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  /** Gesetzt, wenn statt Server-Daten der Offline-Cache gezeigt wird. */
  offlineSince: string | null;
  error: ApiError | null;
  refresh: (options?: { quiet?: boolean }) => Promise<void>;
  /** Lokale (optimistische) Änderung, z. B. direkt nach „Beliefern fertig“. */
  update: (updater: (current: T | null) => T | null) => void;
};

/**
 * Lädt eine Item-Liste.
 *
 * - Erstes Laden: Spinner (`loading`) – es wird **kein** alter Cache-Stand
 *   vorweggeschoben.
 * - Aktualisieren: dezenter Indikator (`refreshing`), die aktuellen Daten
 *   bleiben sichtbar.
 * - Kein Netz: letzter Cache-Stand mit `offlineSince` (Zeitstempel).
 * - Ein laufender neuerer Request gewinnt; ältere Antworten werden verworfen.
 */
export function useItemList<T>(
  url: string | null,
  parse: (body: Record<string, unknown>) => T,
  perfName?: string,
): ItemListState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [refreshing, setRefreshing] = useState(false);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const runIdRef = useRef(0);

  const run = useCallback(
    async (options?: { quiet?: boolean }) => {
      if (!url) return;
      const runId = ++runIdRef.current;
      if (!options?.quiet) setLoading(true);
      setRefreshing(true);
      setError(null);
      if (perfName) startListPerf(perfName);

      const result = await loadList(url, parseRef.current);
      // Ein neuerer Lauf hat übernommen – diese (ältere) Antwort verwerfen.
      if (runId !== runIdRef.current) return;

      setData(result.data);
      setOfflineSince(result.offlineSince);
      setError(result.error);
      setLoading(false);
      setRefreshing(false);
      if (perfName) {
        endListPerf(perfName, {
          source: result.offlineSince ? "offline" : "network",
          count: null,
        });
      }
    },
    [url, perfName],
  );

  useEffect(() => {
    // Endpunkt gewechselt (anderes Objekt, anderer Filter): alten Stand
    // verwerfen, damit nie Daten des vorherigen Eintrags zu sehen sind.
    runIdRef.current++;
    setData(null);
    setOfflineSince(null);
    setError(null);
    if (!url) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setLoading(true);
    void run();
  }, [run, url]);

  const refresh = useCallback(
    async (options?: { quiet?: boolean }) => {
      await run(options);
    },
    [run],
  );

  const update = useCallback(
    (updater: (current: T | null) => T | null) =>
      setData((current) => updater(current)),
    [],
  );

  return {
    data,
    loading,
    refreshing,
    offlineSince,
    error,
    refresh,
    update,
  };
}
