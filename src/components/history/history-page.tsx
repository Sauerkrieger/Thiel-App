"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  History,
  Trash2,
  KeyRound,
  Search,
  Truck,
  User as UserIcon,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SetupHint } from "@/components/setup-hint";
import { offlineFetch, offlineReadCached } from "@/lib/offline/fetch";
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
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TourHistoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Stale-while-revalidate: gecachte Touren sofort anzeigen, frische Daten
  // parallel vom Server nachladen (fresh = nach einer Mutation erzwungen).
  const load = useCallback(async (fresh = false) => {
    setError(null);
    const params = new URLSearchParams();
    if (isAdmin && filterUserId && filterUserId !== "all") {
      params.set("user_id", filterUserId);
    }
    const url = `/api/tours?${params.toString()}`;
    const cached = fresh ? null : await offlineReadCached(url);
    if (cached && Array.isArray(cached.tours) && cached.tours.length > 0) {
      setTours(cached.tours as TourHistoryItem[]);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await offlineFetch(url, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        // Bereits sichtbare Cache-Daten nicht durch eine Fehlermeldung ersetzen.
        if (!cached) {
          setError({ code: body.code, message: body.error ?? "Unbekannter Fehler" });
        }
        return;
      }
      setTours(body.tours ?? []);
    } catch {
      if (!cached) {
        setError({ message: "Netzwerkfehler beim Laden der Tourenhistorie." });
      }
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
    offlineFetch("/api/auth/users", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((body) => setUsers(body.users ?? []))
      .catch(() => setUsers([]));
  }, [isAdmin]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await offlineFetch(`/api/tours/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Tour konnte nicht gelöscht werden.");
        return;
      }
      toast.success("Tour gelöscht.");
      setDeleteTarget(null);
      await load(true);
    } catch {
      toast.error("Tour konnte nicht gelöscht werden.");
    } finally {
      setDeleting(false);
    }
  }

  const filteredLabel = useMemo(() => {
    if (!isAdmin) return null;
    if (!filterUserId || filterUserId === "all") return "Alle Personen";
    const found = users.find((u) => u.id === filterUserId);
    return found?.name ?? "Unbekannt";
  }, [isAdmin, filterUserId, users]);

  // Freitext-Suche über Fahrername, Objektname/-adresse, Datum und Schlüsselnummer.
  const filteredTours = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tours;
    return tours.filter((tour) => {
      const dateText = new Date(tour.date + "T00:00:00");
      const haystack = [
        tour.driver_name ?? "",
        ...(tour.delivered_objects ?? []),
        ...(tour.delivered_addresses ?? []),
        // Kunden-Infos sind Admin-Daten – nur Admins können danach suchen.
        ...(isAdmin ? (tour.delivered_customers ?? []) : []),
        ...(tour.undeliverable ?? []).flatMap((u) => [u.object_name, u.reason ?? ""]),
        ...(tour.key_numbers ?? []).flatMap((key) => [`nr. ${key}`, String(key)]),
        tour.start_time ? `start ${tour.start_time.slice(0, 5)}` : "",
        tour.date,
        dateText.toLocaleDateString("de-DE"),
        dateText.toLocaleDateString("de-DE", {
          weekday: "short",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        dateText.toLocaleDateString("de-DE", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [tours, search]);

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

      {/* Suche: Fahrer, Objektname/-adresse, Datum, Schlüsselnummer */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Suchen: Fahrer, Objekt, Adresse, Datum, Schlüsselnummer…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
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
        ) : filteredTours.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <Search className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-3 text-base font-semibold">Keine Treffer</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Keine Touren passen zu „{search}“.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTours.map((tour) => (
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
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Tour vom ${new Date(tour.date + "T00:00:00").toLocaleDateString("de-DE")} löschen`}
                        onClick={() => setDeleteTarget(tour)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
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
                  {(tour.undeliverable ?? []).length > 0 && (
                    <div className="mt-2">
                      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                        Nicht lieferbar ({tour.undeliverable.length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(tour.undeliverable ?? []).map((u, i) => (
                          <Badge key={`${u.object_name}-${i}`} variant="warning" className="gap-1">
                            <XCircle className="h-3 w-3" />
                            {u.object_name}
                            {u.reason ? ` – ${u.reason}` : ""}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {(tour.key_numbers ?? []).length > 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <KeyRound className="h-3.5 w-3.5 text-primary" />
                      Schlüssel mitgenommen: {(tour.key_numbers ?? []).map((key) => `Nr. ${key}`).join(", ")}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lösch-Bestätigung (nur Admin) */}
      {isAdmin && (
        <Dialog
          open={deleteTarget !== null}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Tour unwiderruflich löschen?</DialogTitle>
              <DialogDescription>
                {deleteTarget && (
                  <>
                    Die Tour vom{" "}
                    <strong>
                      {new Date(
                        deleteTarget.date + "T00:00:00",
                      ).toLocaleDateString("de-DE", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </strong>{" "}
                    {deleteTarget.start_time && <>um {deleteTarget.start_time.slice(0, 5)} Uhr </>}
                    ({STATUS_LABELS[deleteTarget.status]},{" "}
                    {deleteTarget.delivered_count}/{deleteTarget.total_stops} Stopps
                    beliefert) wird dauerhaft aus der Historie entfernt. Stopps
                    und Vormerkungen dieser Tour werden ebenfalls gelöscht.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Abbrechen
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? "Wird gelöscht…" : "Löschen"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
