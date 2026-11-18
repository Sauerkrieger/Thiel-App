"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  History,
  Trash2,
  KeyRound,
  MapPin,
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
import { ListStatus } from "@/components/list-status";
import { offlineFetch } from "@/lib/offline/fetch";
import { useItemList } from "@/lib/use-item-list";
import { useRealtimeRefresh } from "@/lib/realtime";
import type { TourHistoryItem, UserListItem } from "@/types/api";

const STATUS_LABELS: Record<TourHistoryItem["status"], string> = {
  packing: "Packing",
  in_transit: "In transit",
  completed: "Completed",
};

export function HistoryPage({ isAdmin }: { isAdmin: boolean }) {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [filterUserId, setFilterUserId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TourHistoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Nur aktuelle Daten: die Historie kommt vom Server, der Offline-Cache ist
  // reiner Fallback (mit Zeitstempel). Filterwechsel lädt neu (Spinner).
  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (isAdmin && filterUserId && filterUserId !== "all") {
      params.set("user_id", filterUserId);
    }
    const query = params.toString();
    return query ? `/api/tours?${query}` : "/api/tours";
  }, [isAdmin, filterUserId]);
  const list = useItemList<TourHistoryItem[]>(
    listUrl,
    (body) => (body.tours ?? []) as TourHistoryItem[],
    "history",
  );
  const tours = useMemo(() => list.data ?? [], [list.data]);
  const loading = list.loading;
  const error = list.error;


  // Realtime (nur Admins): Bei Touren-Aenderungen (Abschluss, neuer Start,
  // Statuswechsel) die Historie automatisch neu laden.
  useRealtimeRefresh(
    isAdmin,
    ["active_tours"],
    () => { void list.refresh({ quiet: true }); },
  );
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
        toast.error(body.error ?? "Could not delete the tour.");
        return;
      }
      toast.success("Tour deleted.");
      setDeleteTarget(null);
      await list.refresh({ quiet: true });
    } catch {
      toast.error("Could not delete the tour.");
    } finally {
      setDeleting(false);
    }
  }

  const filteredLabel = useMemo(() => {
    if (!isAdmin) return null;
    if (!filterUserId || filterUserId === "all") return "All people";
    const found = users.find((u) => u.id === filterUserId);
    return found?.name ?? "Unknown";
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
        ...(tour.unknown_targets ?? []).flatMap((target) => [target.name, target.address]),
        ...(tour.key_numbers ?? []).flatMap((key) => [`no. ${key}`, String(key)]),
        tour.start_time ? `start ${tour.start_time.slice(0, 5)}` : "",
        tour.date,
        dateText.toLocaleDateString("en-GB"),
        dateText.toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        dateText.toLocaleDateString("en-GB", {
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
  }, [tours, search, isAdmin]);

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
              ? "All driven tours of all people at a glance."
              : "Your own completed tours."}
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
                <SelectItem value="all">All people</SelectItem>
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
            placeholder="Search: driver, object, address, date, key number…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-6">
        <ListStatus
          refreshing={list.refreshing}
          offlineSince={list.offlineSince}
          className="mb-3"
        />
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
            <h2 className="mt-3 text-base font-semibold">No tours yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {filteredLabel && filteredLabel !== "All people"
                ? `No tours for “${filteredLabel}” yet.`
                : "Tours appear here once they have been started and driven."}
            </p>
          </div>
        ) : filteredTours.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <Search className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-3 text-base font-semibold">No results</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              No tours match “{search}“.
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
                      {new Date(tour.date + "T00:00:00").toLocaleDateString("en-GB", {
                        weekday: "short",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                    {tour.start_time && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        Start {tour.start_time.slice(0, 5)}
                      </span>
                    )}
                    {isAdmin && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <UserIcon className="h-3.5 w-3.5" />
                        {tour.driver_name ?? "Unknown"}
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
                        aria-label={`Delete tour of ${new Date(tour.date + "T00:00:00").toLocaleDateString("en-GB")}`}
                        onClick={() => setDeleteTarget(tour)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Delivered objects ({tour.delivered_count}/{tour.total_stops})
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
                      No objects delivered yet.
                    </p>
                  )}
                  {(tour.undeliverable ?? []).length > 0 && (
                    <div className="mt-2">
                      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                        Not deliverable ({tour.undeliverable.length})
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
                  {(tour.unknown_targets ?? []).length > 0 && (
                    <div className="mt-2">
                      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Unknown destinations ({tour.unknown_targets.length})
                      </p>
                      <div className="space-y-1">
                        {tour.unknown_targets.map((target, index) => (
                          <p key={`${target.name}-${index}`} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                            <span>
                              <span className="font-medium text-foreground">{target.name}</span>
                              <span className="block">{target.address}</span>
                            </span>
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  {(tour.key_numbers ?? []).length > 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <KeyRound className="h-3.5 w-3.5 text-primary" />
                      Keys collected: {(tour.key_numbers ?? []).map((key) => `No. ${key}`).join(", ")}
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
              <DialogTitle>Delete tour permanently?</DialogTitle>
              <DialogDescription>
                {deleteTarget && (
                  <>
                    Die Tour of{" "}
                    <strong>
                      {new Date(
                        deleteTarget.date + "T00:00:00",
                      ).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </strong>{" "}
                    {deleteTarget.start_time && <>at {deleteTarget.start_time.slice(0, 5)} </>}
                    ({STATUS_LABELS[deleteTarget.status]},{" "}
                    {deleteTarget.delivered_count}/{deleteTarget.total_stops} stops
                    delivered) is permanently removed from the history. Stops
                    and reservations of this tour will also be deleted.
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
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
