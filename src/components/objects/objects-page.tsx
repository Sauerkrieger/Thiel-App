"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Camera,
  KeyRound,
  ListChecks,
  MapPin,
  Pencil,
  Plus,
  Search,
  Store,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { PhotoImportDialog } from "./photo-import-dialog";
import { SetupHint } from "@/components/setup-hint";
import type { ApiError, ObjectWithItems } from "@/types/api";

/** Sortiermöglichkeiten der Objektliste (je Attribut). */
type ObjectSort =
  | "name-asc"
  | "name-desc"
  | "address-asc"
  | "address-desc"
  | "key-asc"
  | "key-desc"
  | "category-asc"
  | "items-asc"
  | "items-desc";

export function ObjectsPage({ isAdmin }: { isAdmin: boolean }) {
  const [objects, setObjects] = useState<ObjectWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ObjectSort>("name-asc");

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/objects", { cache: "no-store" });
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? objects.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            o.address.toLowerCase().includes(q),
        )
      : [...objects];
    list.sort((a, b) => {
      switch (sort) {
        case "name-desc":
          return b.name.localeCompare(a.name, "de");
        case "address-asc":
          return a.address.localeCompare(b.address, "de");
        case "address-desc":
          return b.address.localeCompare(a.address, "de");
        case "key-asc":
          return (a.key_number ?? Number.MAX_SAFE_INTEGER) -
            (b.key_number ?? Number.MAX_SAFE_INTEGER);
        case "key-desc":
          return (b.key_number ?? -1) - (a.key_number ?? -1);
        case "category-asc":
          return a.category.localeCompare(b.category, "de");
        case "items-asc":
          return itemCount(a) - itemCount(b);
        case "items-desc":
          return itemCount(b) - itemCount(a);
        default:
          return a.name.localeCompare(b.name, "de");
      }
    });
    return list;
  }, [objects, search, sort]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/objects/${deleteTarget.id}`, {
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

      {/* Suche + Sortierung */}
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
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Sortierung</Label>
          <Select
            value={sort}
            onValueChange={(v) => setSort(v as ObjectSort)}
          >
            <SelectTrigger className="w-48" aria-label="Sortierung der Objekte">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name (A–Z)</SelectItem>
              <SelectItem value="name-desc">Name (Z–A)</SelectItem>
              <SelectItem value="address-asc">Adresse (A–Z)</SelectItem>
              <SelectItem value="address-desc">Adresse (Z–A)</SelectItem>
              <SelectItem value="key-asc">Schlüssel-Nr. aufsteigend</SelectItem>
              <SelectItem value="key-desc">Schlüssel-Nr. absteigend</SelectItem>
              <SelectItem value="category-asc">Kategorie (A–Z)</SelectItem>
              <SelectItem value="items-asc">Items aufsteigend</SelectItem>
              <SelectItem value="items-desc">Items absteigend</SelectItem>
            </SelectContent>
          </Select>
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
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead>Adresse</TableHead>
                  <TableHead>Schlüssel</TableHead>
                  <TableHead>Kategorie</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="pr-4 text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((obj) => (
                  <TableRow key={obj.id} className="group">
                    <TableCell className="pl-4 font-medium">{obj.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        {obj.address}
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
                      {isAdmin ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 px-2 text-muted-foreground"
                          onClick={() => setItemsDialog({ open: true, object: obj })}
                        >
                          <ListChecks className="h-3.5 w-3.5" />
                          {itemCount(obj)}
                        </Button>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                          <ListChecks className="h-3.5 w-3.5" />
                          {itemCount(obj)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4">
                      {isAdmin ? (
                        <div className="flex items-center justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`${obj.name} bearbeiten`}
                            onClick={() => setFormDialog({ open: true, object: obj })}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            aria-label={`${obj.name} löschen`}
                            onClick={() => setDeleteTarget(obj)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Dialoge (nur Admin) */}
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
          <ItemsDialog
            open={itemsDialog.open}
            object={itemsDialog.object}
            onOpenChange={(open) =>
              setItemsDialog((prev) => ({ ...prev, open }))
            }
            onChanged={() => void load()}
          />
          <PhotoImportDialog
            open={photoOpen}
            onOpenChange={setPhotoOpen}
            onImported={() => void load()}
          />
        </>
      )}

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


