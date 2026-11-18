"use client";

import { CloudOff, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Zeitstempel als „TT.MM., HH:MM“ (lokale Zeit). */
function formatStamp(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Statuszeile über einer Liste: zeigt entweder „Aktualisiere…“ (dezenter
 * Spinner) oder – wenn das Netz nicht antwortet – den Zeitpunkt des
 * angezeigten Offline-Stands. Ohne Status wird nichts gerendert.
 */
export function ListStatus({
  refreshing,
  offlineSince,
  className,
}: {
  refreshing?: boolean;
  offlineSince?: string | null;
  className?: string;
}) {
  const stamp = formatStamp(offlineSince ?? null);
  if (!refreshing && !offlineSince) return null;

  return (
    <p
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      {offlineSince ? (
        <>
          <CloudOff className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span className="font-medium text-amber-700 dark:text-amber-400">
            Offline snapshot{stamp ? ` from ${stamp}` : ""}
          </span>
          <span>– no connection to the server.</span>
        </>
      ) : (
        <>
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span>Updating…</span>
        </>
      )}
    </p>
  );
}
