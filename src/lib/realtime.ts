"use client";

import { useEffect, useRef } from "react";
import type { Database } from "@/types/database";

type TableName = keyof Database["public"]["Tables"];

const DEBOUNCE_MS = 500;

/**
 * Hook: subscribed auf Postgres-Realtime-Changes und ruft onRefresh auf,
 * sobald sich etwas in den angegebenen Tabellen aendert.
 * Nur fuer Admins aktiv (enabled=true). Events werden mit 500 ms entprellt.
 *
 * Damit Events ankommen, müssen zwei Voraussetzungen erfüllt sein:
 * 1. Die Tabellen stecken in der `supabase_realtime`-Publication
 *    (Migration 20260812000000_realtime_publication.sql).
 * 2. Der Browser-Client trägt die Session-Cookies (createBrowserClient in
 *    src/lib/supabase/browser.ts) – sonst filtert RLS alle Events raus.
 */
export function useRealtimeRefresh(
  enabled: boolean,
  tables: TableName[],
  onRefresh: () => void,
) {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled || tables.length === 0) return;

    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    // Wird gesetzt, sobald der Channel asynchron erstellt wurde; der
    // Effect-Cleanup unten ruft sie beim Unmount auf. (Vorher ging die
    // Cleanup-Funktion im .then() verloren – Channels blieben offen,
    // bei StrictMode lagen dadurch doppelte Subscriptions vor.)
    let removeChannel: (() => void) | null = null;

    const fire = () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!cancelled) onRefreshRef.current();
        debounceTimer = null;
      }, DEBOUNCE_MS);
    };

    import("@/lib/supabase/browser")
      .then(async ({ getSupabaseBrowser }) => {
        if (cancelled) return;
        const supabase = getSupabaseBrowser();
        // Diagnose: Ist die Session im Browser-Client ueberhaupt vorhanden?
        // Ohne Session verbindet sich Realtime anonym und RLS filtert alle
        // Events – die Seite sieht dann aus, als kaeme nichts an.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (process.env.NODE_ENV !== "production") {
          if (!session) {
            console.warn(
              "[Realtime] KEINE Session im Browser-Client – Events werden durch RLS gefiltert!",
            );
          } else {
            console.info(
              `[Realtime] Session ok (${session.user?.email ?? "unbekannt"})`,
            );
          }
        }
        if (cancelled) return;
        const channel = supabase.channel("admin-realtime");
        for (const table of tables) {
          channel.on(
            "postgres_changes",
            { event: "*", schema: "public", table },
            (payload) => {
              if (process.env.NODE_ENV !== "production") {
                console.info(
                  `[Realtime] Event: ${table} (${payload.eventType}) → Refresh`,
                );
              }
              fire();
            },
          );
        }
        channel.subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            // Nur im Dev-Log ausgeben, damit Produktions-Konsolen ruhig bleiben.
            if (process.env.NODE_ENV !== "production") {
              console.info(
                `[Realtime] Subscribed auf: ${tables.join(", ")}`,
              );
            }
          } else {
            console.warn(
              `[Realtime] Subscription-Status fuer ${tables.join(", ")}: ${status}`,
            );
          }
        });
        removeChannel = () => {
          supabase.removeChannel(channel);
        };
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[Realtime] Konnte nicht geladen werden:", error);
        }
      });

    return () => {
      cancelled = true;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      removeChannel?.();
    };
  }, [enabled, ...tables]);
}
