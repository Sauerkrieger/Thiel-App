"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  History,
  Truck,
  User as UserIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SetupHint } from "@/components/setup-hint";
import type { ApiError, TourHistoryItem, UserListItem } from "@/types/api";

const STATUS_LABELS: Record<TourHistoryItem["status"], string> = {
  packing: "Packen",
  in_transit: "Unterwegs",
  completed: "Abgeschlossen",
};

export function HistoryPage({ isAdmin }: { isAdmin: boolean }) {
  const [tours, setTours] = useState<TourHistoryItem[]>([]);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [filterUserId, setFilterUserId] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (isAdmin && filterUserId && filterUserId !== "all") {
        params.set("user_id", filterUserId);
      }
      const res = await fetch(`/api/tours?${params.toString()}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        setError({ code: body.code, message: body.error ?? "Unbekannter Fehler" });
        return;
      }
      setTours(body.tours ?? []);
    } catch {
      setError({ message: "Netzwerkfehler beim Laden der Tourenhistorie." });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, filterUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Für Admins: Liste aller Nutzer laden (Filter „pro Person").
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/auth/users", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((body) => setUsers(body.users ?? []))
      .catch(() => setUsers([]));
  }, [isAdmin]);

  const filteredLabel = useMemo(() => {
    if (!isAdmin) return null;
    if (!filterUserId || filterUserId === "all") return "Alle Personen";
    const found = users.find((u) => u.id === filterUserId);
    return found?.name ?? "Unbekannt";
  }, [isAdmin, filterUserId, users]);

  return (
    <div className="container py-6 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <History className="h-6 w-6 text-primary" />
            Tourenhistorie
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin
              ? "Alle gefahrenen Touren aller Personen im Überblick."
              : "Deine eigenen gefahrenen Touren."}
          </p>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm text-muted-foreground">Person:</span>
            <Select value={filterUserId} onValueChange={setFilterUserId}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Personen</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="mt-6">
        {error?.code === "SUPABASE_NOT_CONFIGURED" ? (
          <SetupHint message={error.message} />
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
            {error.message}
          </div>
        ) : loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : tours.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <Truck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-3 text-base font-semibold">Noch keine Touren</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {filteredLabel && filteredLabel !== "Alle Personen"
                ? `Für „${filteredLabel}“ gibt es noch keine Touren.`
                : "Sobald Touren gestartet und gefahren werden, erscheinen sie hier."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tours.map((tour) => (
              <div
                key={tour.id}
                className="rounded-lg border bg-card p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <CalendarDays className="h-4 w-4 text-primary" />
                      {new Date(tour.date + "T00:00:00").toLocaleDateString("de-DE", {
                        weekday: "short",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                    {tour.start_time && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        Start {tour.start_time.slice(0, 5)} Uhr
                      </span>
                    )}
                    {isAdmin && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <UserIcon className="h-3.5 w-3.5" />
                        {tour.driver_name ?? "Unbekannt"}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        tour.status === "completed"
                          ? "success"
                          : tour.status === "in_transit"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {STATUS_LABELS[tour.status]}
                    </Badge>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/tour/${tour.id}`}>Details</Link>
                    </Button>
                  </div>
                </div>

                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Belieferte Objekte ({tour.delivered_count}/{tour.total_stops})
                  </p>
                  {tour.delivered_objects.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {tour.delivered_objects.map((name, i) => (
                        <Badge key={`${name}-${i}`} variant="success" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Noch keine Objekte beliefert.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
