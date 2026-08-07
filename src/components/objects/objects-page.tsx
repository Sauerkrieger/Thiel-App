"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Camera,
  ChevronsUpDown,
  Info,
  KeyRound,
  ListChecks,
  MapPin,
  Plus,
  Search,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { cleanAddressLabel } from "@/lib/address";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ObjectFormDialog } from "./object-form-dialog";
import { ItemsDialog } from "./items-dialog";
import { ObjectInfoDialog } from "./object-info-dialog";
import { PhotoImportDialog } from "./photo-import-dialog";
import { SetupHint } from "@/components/setup-hint";
import { offlineFetch } from "@/lib/offline/fetch";
import type { ApiError, ObjectWithItems } from "@/types/api";
import type { UserRole } from "@/types/database";

/** Sortierbare Spalten der Objektliste (Klick auf Spaltenkopf). */
type SortKey = "name" | "address" | "key" | "category" | "items" | "lastDelivery";

type SortState = {
  key: SortKey;
  /** 1 = aufsteigend, -1 = absteigend. */
  dir: 1 | -1;
};

export function ObjectsPage({ userRole }: { userRole: UserRole }) {
  const isAdmin = userRole === "admin";
  // Reinigungskraft: reduzierte Spaltenansicht (ohne „Zuletzt am“/„Info“) und
  // Items nur lesbar – Springer & Co. sehen weiterhin alles.
  const isFacilityManager = userRole === "facility_manager";

  const [objects, setObjects] = useState<ObjectWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "name", dir: 1 });

  const [formDialog, setFormDialog] = useState<{
    open: boolean;
    object: ObjectWithItems | null;
  }>({ open: false, object: null });
  const [itemsDialog, setItemsDialog] = useState<{
    open: boolean;
    object: ObjectWithItems | null;
  }>({ open: false, object: null });
  const [photoOpen, setPhotoOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ObjectWithItems | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [infoTarget, setInfoTarget] = useState<ObjectWithItems | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await offlineFetch("/api/objects", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setError({
          code: body.code,
          message: body.error ?? "Unbekannter Fehler",
        });
        return;
      }
      setObjects(body.objects ?? []);
    } catch {
      setError({ message: "Netzwerkfehler beim Laden der Objekte." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const itemCount = (o: ObjectWithItems) => o.object_items?.length ?? 0;

  /** Klick auf Spaltenkopf: gleiche Spalte toggelt die Richtung, sonst aufsteigend. */
  function toggleSort(key: SortKey) {
    setSort((prev) => ({
      key,
      dir: prev.key === key ? (prev.dir === 1 ? -1 : 1) : 1,
    }));
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? objects.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            o.address.toLowerCase().includes(q),
        )
      : [...objects];
    const dir = sort.dir;
    list.sort((a, b) => {
      switch (sort.key) {
        case "address":
          return a.address.localeCompare(b.address, "de") * dir;
        case "key":
          // Objekte ohne Schlüsselnummer immer ans Ende
          if (a.key_number == null && b.key_number == null) return 0;
          if (a.key_number == null) return 1;
          if (b.key_number == null) return -1;
          return (a.key_number - b.key_number) * dir;
        case "category":
          return a.category.localeCompare(b.category, "de") * dir;
        case "items":
          return (itemCount(a) - itemCount(b)) * dir;
        case "lastDelivery":
          // Objekte ohne Lieferdatum immer ans Ende
          if (a.last_delivery_at == null && b.last_delivery_at == null) return 0;
          if (a.last_delivery_at == null) return 1;
          if (b.last_delivery_at == null) return -1;
          return a.last_delivery_at.localeCompare(b.last_delivery_at) * dir;
        default:
          return a.name.localeCompare(b.name, "de") * dir;
      }
    });
    return list;
  }, [objects, search, sort]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await offlineFetch(`/api/objects/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Löschen fehlgeschlagen.");
        return;
      }
      toast.success(`„${deleteTarget.name}" wurde gelöscht.`);
      setDeleteTarget(null);
      await load();
    } catch {
      toast.error("Löschen fehlgeschlagen.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="container py-6 sm:py-10">
      {/* Kopfbereich */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Objekte</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Verwaltung aller Lieferobjekte, Treppenhäuser und deren
            Standard-Items.
          </p>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setPhotoOpen(true)}
              disabled={loading}
            >
              <Camera />
              Foto-Import
            </Button>
            <Button onClick={() => setFormDialog({ open: true, object: null })}>
              <Plus />
              Neues Objekt
            </Button>
          </div>
        )}
      </div>

      {/* Suche (Sortierung jetzt über die Spaltenköpfe) */}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Objekte suchen…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Inhalt */}
      <div className="mt-4">
        {error?.code === "SUPABASE_NOT_CONFIGURED" ? (
          <SetupHint message={error.message} />
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
            {error.message}
          </div>
        ) : loading ? (
          <TableSkeleton />
        ) : objects.length === 0 ? (
          isAdmin ? (
            <EmptyState onCreate={() => setFormDialog({ open: true, object: null })} />
          ) : isFacilityManager ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              Ihnen sind noch keine Objekte zugewiesen. Wende dich an die
              Verwaltung, um Objekte zugewiesen zu bekommen.
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              Noch keine Objekte vorhanden.
            </div>
          )
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Keine Objekte gefunden, die zu „{search}“ passen.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <SortableHeader
                    label="Name"
                    sortKey="name"
                    sort={sort}
                    onToggle={toggleSort}
                    className="pl-4"
                  />
                  <SortableHeader
                    label="Adresse"
                    sortKey="address"
                    sort={sort}
                    onToggle={toggleSort}
                  />
                  <SortableHeader
                    label="Schlüssel"
                    sortKey="key"
                    sort={sort}
                    onToggle={toggleSort}
                  />
                  <SortableHeader
                    label="Kategorie"
                    sortKey="category"
                    sort={sort}
                    onToggle={toggleSort}
                  />
                  <SortableHeader
                    label="Items"
                    sortKey="items"
                    sort={sort}
                    onToggle={toggleSort}
                  />
                  {!isFacilityManager && (
                    <SortableHeader
                      label="Zuletzt am"
                      sortKey="lastDelivery"
                      sort={sort}
                      onToggle={toggleSort}
                    />
                  )}
                  {!isFacilityManager && (
                    <TableHead className="pr-4 text-right">Info</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((obj) => (
                  <TableRow key={obj.id} className="group">
                    <TableCell className="pl-4 font-medium">{obj.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        {cleanAddressLabel(obj.address)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {obj.key_number != null ? (
                        <span className="inline-flex items-center gap-1.5 font-medium tabular-nums">
                          <KeyRound className="h-3.5 w-3.5 shrink-0 text-primary" />
                          Nr. {obj.key_number}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={obj.category === "objekt" ? "secondary" : "outline"}>
                        <Store className="mr-1 h-3 w-3" />
                        {obj.category === "objekt" ? "Objekt" : "Treppenhaus"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 px-2 text-muted-foreground"
                        onClick={() => setItemsDialog({ open: true, object: obj })}
                        title={
                          isFacilityManager
                            ? `${itemCount(obj)} Items anzeigen`
                            : `${itemCount(obj)} Items anzeigen/bearbeiten`
                        }
                      >
                        <ListChecks className="h-3.5 w-3.5" />
                        {itemCount(obj)}
                      </Button>
                    </TableCell>
                    {!isFacilityManager && (
                      <TableCell>
                        {obj.last_delivery_at ? (
                          <button
                            type="button"
                            onClick={() => setInfoTarget(obj)}
                            className="inline-flex items-center gap-1.5 text-sm tabular-nums text-primary hover:underline"
                            title="Details anzeigen"
                          >
                            <Calendar className="h-3.5 w-3.5 shrink-0" />
                            {new Date(obj.last_delivery_at).toLocaleDateString("de-DE", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "2-digit",
                            })}
                          </button>
                        ) : (
                          <span className="text-sm text-muted-foreground">–</span>
                        )}
                      </TableCell>
                    )}
                    {!isFacilityManager && (
                      <TableCell className="pr-4">
                        <div className="flex items-center justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`${obj.name} Info anzeigen`}
                            title="Details anzeigen"
                            onClick={() => setInfoTarget(obj)}
                          >
                            <Info />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Dialoge */}
      {isAdmin && (
        <>
          <ObjectFormDialog
            open={formDialog.open}
            object={formDialog.object}
            onOpenChange={(open) =>
              setFormDialog((prev) => ({ ...prev, open }))
            }
            onSaved={() => void load()}
          />
          <PhotoImportDialog
            open={photoOpen}
            onOpenChange={setPhotoOpen}
            onImported={() => void load()}
          />
        </>
      )}
      <ItemsDialog
        open={itemsDialog.open}
        object={itemsDialog.object}
        canDelete={isAdmin}
        readOnly={isFacilityManager}
        onOpenChange={(open) =>
          setItemsDialog((prev) => ({ ...prev, open }))
        }
        onChanged={() => void load()}
      />
      <ObjectInfoDialog
        open={!!infoTarget}
        object={infoTarget}
        isAdmin={isAdmin}
        onOpenChange={(open) => {
          if (!open) setInfoTarget(null);
        }}
        onEdit={(object) => {
          setInfoTarget(null);
          setFormDialog({ open: true, object });
        }}
        onDelete={(object) => {
          setInfoTarget(null);
          setDeleteTarget(object);
        }}
      />

      {/* Lösch-Bestätigung */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Objekt löschen?</DialogTitle>
            <DialogDescription>
              „{deleteTarget?.name}“ und alle zugehörigen Items werden
              dauerhaft gelöscht. Wochentags-Defaults, die dieses Objekt
              referenzieren, werden ebenfalls entfernt.
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
            >
              {deleting ? "Wird gelöscht…" : "Löschen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Sortierbarer Spaltenkopf: Klick sortiert auf-/absteigend (Pfeil zeigt Richtung). */
function SortableHeader({
  label,
  sortKey,
  sort,
  onToggle,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onToggle: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const DirectionIcon = active
    ? sort.dir === 1
      ? ArrowUp
      : ArrowDown
    : ChevronsUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        title={`Nach ${label} sortieren`}
        aria-label={`Nach ${label} sortieren${active ? (sort.dir === 1 ? " (absteigend)" : " (aufsteigend)") : ""}`}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide transition-colors",
          active
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        <DirectionIcon className={cn("h-3.5 w-3.5", !active && "opacity-40")} />
      </button>
    </TableHead>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b px-4 py-4 last:border-0"
          >
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="ml-auto h-8 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg border border-dashed bg-card/50 p-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Store className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-base font-semibold">Noch keine Objekte</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        Lege dein erstes Objekt manuell an – Items kannst du später auch per
        Foto-Import hinzufügen.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={onCreate}>
          <Plus />
          Neues Objekt
        </Button>
      </div>
    </div>
  );
}


