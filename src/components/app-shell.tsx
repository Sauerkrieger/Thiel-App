"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/database";

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
    roles: ["driver", "admin"],
  },
  {
    href: "/historie",
    label: "Historie",
    roles: ["driver", "admin"],
  },
  { href: "/einstellungen", label: "Einstellungen", icon: Settings },
];

export function AppShell({
  children,
  userRole,
}: {
  children: React.ReactNode;
  userRole: UserRole | null;
}) {
  const pathname = usePathname();

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
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t py-3 text-center text-xs text-muted-foreground">
        Thiel Dienstleistungen · Liefer- &amp; Tourenplanung
      </footer>
    </div>
  );
}
