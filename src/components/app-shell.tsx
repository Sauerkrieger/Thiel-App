"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Clock3, CloudOff, LoaderCircle, RefreshCw, Settings } from "lucide-react";
import { ClockWidget } from "@/components/time-tracking/clock-widget";
import { cn } from "@/lib/utils";
import {
  initSync,
  setCurrentUserId,
  setCurrentUserRole,
  useSyncState,
} from "@/lib/offline/sync";
import { offlineFetch } from "@/lib/offline/fetch";
import type { UserRole } from "@/types/database";

/**
 * Daten-Endpunkt je Navigationsziel für den Hover-Prefetch. Beim Überfahren
 * eines Nav-Links wird die Daten-Antwort schon einmal geladen und in den
 * IndexedDB-Cache geschrieben – die Seite rendert nach dem Klick dadurch
 * sofort aus dem Cache (Stale-while-revalidate), statt erst aufs Netz zu
 * warten. Nur Tabellen, die der Nutzer auch sehen darf (Nav-Filter greift
 * vorher), werden vorgewärmt.
 */
const DATA_ENDPOINTS: Record<string, () => string> = {
  "/objects": () => "/api/objects",
  "/inventar": () => "/api/inventory",
  "/planung": () => `/api/planning?day_of_week=${new Date().getDay()}`,
  "/historie": () => "/api/tours",
  "/zeiterfassung": () => "/api/time-tracking/summary",
  "/admin/zeiterfassung": () => "/api/admin/time-tracking/overview",
};

// Debounce + Dedupe: nur der zuletzt überfahrene Link wird (kurz) vorgewärmt,
// damit ein schnelles Bewegen über die Leiste keine Fetch-Flut auslöst.
const prefetchTimers = new Map<string, number>();

function prefetchPageData(href: string) {
  const build = DATA_ENDPOINTS[href];
  if (!build) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const existing = prefetchTimers.get(href);
  if (existing !== undefined) window.clearTimeout(existing);
  prefetchTimers.set(
    href,
    window.setTimeout(() => {
      prefetchTimers.delete(href);
      // Antwort wird verworfen – offlineFetch legt erfolgreiche GETs
      // automatisch in den IndexedDB-Cache.
      void offlineFetch(build(), { cache: "no-store" }).catch(() => {});
    }, 250),
  );
}

type NavItem = {
  href: string;
  label: string;
  icon?: typeof Settings;
  /** Nur für diese Rollen sichtbar (null = für alle). */
  roles?: UserRole[];
};

const NAV_ITEMS: NavItem[] = [
  { href: "/objects", label: "Objekte" },
  {
    href: "/inventar",
    label: "Inventar",
    roles: ["admin"],
  },
  {
    href: "/planung",
    label: "Tourenplanung",
    roles: ["driver", "admin", "substitute"],
  },
  {
    href: "/historie",
    label: "Historie",
    roles: ["driver", "admin", "substitute"],
  },
  {
    href: "/zeiterfassung",
    label: "Zeiterfassung",
  },
  {
    href: "/admin/zeiterfassung",
    label: "Zeitadmin",
    roles: ["admin"],
  },
  { href: "/einstellungen", label: "Einstellungen", icon: Settings },
];

export function AppShell({
  children,
  userRole,
  userId,
}: {
  children: React.ReactNode;
  userRole: UserRole | null;
  userId: string | null;
}) {
  const pathname = usePathname();
  const sync = useSyncState();

  // Rolle synchron setzen (vor Kind-Effekten), damit die Offline-Layer-Filter
  // für Reinigungskräfte schon beim ersten Seitenaufruf greifen.
  setCurrentUserRole(userRole);
  if (userId) setCurrentUserId(userId);

  // Sync-Engine initialisieren (Offline-Erkennung, Zeit-Offset, Reconnect-Sync)
  useEffect(() => {
    if (userId) initSync(userId);
  }, [userId]);

  // Service Worker nur im Production-Build registrieren (im Dev-Modus würde
  // er Hot-Reload/HMR stören). Er cached die App-Shell, damit die App auch
  // ganz ohne Internet frisch geöffnet werden kann (siehe public/sw.js).
  // Direkt im Effekt registrieren – ein window-„load“-Listener kann bei
  // schnellen Seiten bereits gefeuert haben, bevor der Effekt lief.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const id = window.setTimeout(() => {
      void navigator.serviceWorker.register("/sw.js").catch((error) => {
        // Service Worker ist optional – App funktioniert auch ohne.
        console.warn("[SW] Registrierung fehlgeschlagen:", error);
      });
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // Login-Seite: ohne App-Shell (Header/Footer) rendern.
  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="container flex h-14 items-center gap-4">
          <Link
            href="/"
            className="flex min-w-0 shrink-0 items-center gap-2.5"
            aria-label="Thiel Dienstleistungen – Startseite"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Building2 className="h-4 w-4" />
            </span>
            <span className="hidden truncate text-sm font-semibold tracking-tight sm:inline">
              Thiel Dienstleistungen
            </span>
          </Link>
          {/* Horizontal scrollbar: bei vielen Tabs / schmalen Screens (Handy)
              läuft die Leiste seitlich weiter, statt umzubrechen. */}
          <nav
            className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {NAV_ITEMS.filter(
              (item) => !item.roles || (userRole && item.roles.includes(userRole)),
            ).map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onMouseEnter={() => prefetchPageData(item.href)}
                  onFocus={() => prefetchPageData(item.href)}
                  aria-label={item.icon ? item.label : undefined}
                  title={item.icon ? item.label : undefined}
                  className={cn(
                    "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    item.icon && "px-2",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {Icon ? <Icon className="h-4 w-4" /> : item.label}
                </Link>
              );
            })}
          </nav>
          {userRole && (
            // Am Desktop bleibt die Stempeluhr oben im Header. Am Handy wird
            // sie in die untere Leiste verschoben (siehe unten) – oben wird es
            // sonst mit Logo, Navigation und Sync-Status zu eng.
            <div className="hidden items-center sm:flex">
              <ClockWidget userId={userId} />
            </div>
          )}
          <SyncBadge sync={sync} />
        </div>
      </header>
      <main className="flex-1">{children}</main>
      {/* Mobile Stempeluhr: feste Leiste am unteren Rand (nur Handy). Sie ist
          auf JEDER Seite sichtbar – Seiten mit eigener Bottom-Leiste
          (Tourenplanung, Tour) stapeln ihre Leiste darüber (bottom-14). */}
      {userRole && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:hidden">
          <div className="container flex h-14 items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Clock3 className="h-4 w-4 text-primary" />
              Stempeluhr
            </span>
            <ClockWidget userId={userId} />
          </div>
        </div>
      )}
      <footer className="border-t py-3 pb-20 text-center text-xs text-muted-foreground sm:pb-3">
        Thiel Dienstleistungen · Liefer- &amp; Tourenplanung
      </footer>
    </div>
  );
}

/**
 * Kleiner Sync-/Offline-Indikator im Header. Unsichtbar, wenn alles
 * synchronisiert ist – sonst: Offline, laufender Sync, ausstehende
 * Änderungen oder ein Fehler.
 */
function SyncBadge({ sync }: { sync: ReturnType<typeof useSyncState> }) {
  if (
    sync.online &&
    !sync.syncing &&
    sync.pendingCount === 0 &&
    !sync.lastError
  ) {
    return null;
  }

  const lastSync = sync.lastSyncAt
    ? ` · Letzter Sync: ${new Date(sync.lastSyncAt).toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      })} Uhr`
    : "";

  if (!sync.online) {
    return (
      <span
        title={`Offline – Änderungen werden lokal gespeichert.${lastSync}`}
        className="ml-1 flex shrink-0 items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive"
      >
        <CloudOff className="h-3.5 w-3.5" />
        Offline
      </span>
    );
  }

  if (sync.syncing) {
    return (
      <span
        title={`Synchronisation läuft.${lastSync}`}
        className="ml-1 flex shrink-0 items-center gap-1 rounded-full border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
      >
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        Synchronisiert…
      </span>
    );
  }

  if (sync.pendingCount > 0) {
    return (
      <button
        type="button"
        title={`${sync.pendingCount} Änderung${sync.pendingCount === 1 ? "" : "en"} warten auf Synchronisation – klicken zum Synchronisieren.${lastSync}`}
        onClick={() => void import("@/lib/offline/sync").then((m) => m.syncNow())}
        className="ml-1 flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        {sync.pendingCount} offline
      </button>
    );
  }

  return (
    <span
      title={`${sync.lastError ?? "Sync-Fehler"}${lastSync}`}
      className="ml-1 flex shrink-0 items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive"
    >
      <CloudOff className="h-3.5 w-3.5" />
      Sync-Fehler
    </span>
  );
}
