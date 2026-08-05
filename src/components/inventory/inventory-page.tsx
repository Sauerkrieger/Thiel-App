"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ListChecks, PackageCheck, Plus, Search, Trash2 } from "lucide-react";
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
import { SetupHint } from "@/components/setup-hint";
import { offlineFetch } from "@/lib/offline/fetch";
import type { ApiError } from "@/types/api";
import type { InventoryItem } from "@/types/database";

type SortOrder = "az" | "za";

/**
 * Inventar (nur Admin): alle Items namentlich gelistet mit Suche,
 * Sortierung, Anmerkungen (editierbar) und Anlegen/Löschen.
 */
export function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOrder>("az");

  // Neues Item
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await offlineFetch("/api/inventory", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setError({
          code: body.code,
          message: body.error ?? "Unbekannter Fehler",
        });
        return;
      }
      setItems(body.items ?? []);
    } catch {
      setError({ message: "Netzwerkfehler beim Laden des Inventars." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Suche über Name + Anmerkung, danach sortieren (alphabetisch A–Z / Z–A).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? items.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            (item.note ?? "").toLowerCase().includes(q),
        )
      : items;
    return [...list].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, "de");
      return sort === "az" ? cmp : -cmp;
    });
  }, [items, search, sort]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const res = await offlineFetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          note: newNote.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Item konnte nicht angelegt werden.");
        return;
      }
      setNewName("");
      setNewNote("");
      await load();
      toast.success(`„${body.item?.name ?? newName.trim()}" zum Inventar hinzugefügt.`);
    } catch {
      toast.error("Item konnte nicht angelegt werden.");
    } finally {
      setAdding(false);
    }
  }

  /** Ein Feld eines Items aktualisieren (Inline-Edit per onBlur). */
  async function handleUpdate(item: InventoryItem, patch: Partial<InventoryItem>) {
    try {
      const res = await offlineFetch(`/api/inventory/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Änderung fehlgeschlagen.");
        return;
      }
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)),
      );
    } catch {
      toast.error("Änderung fehlgeschlagen.");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await offlineFetch(`/api/inventory/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Löschen fehlgeschlagen.");
        return;
      }
      toast.success(`„${deleteTarget.name}" wurde gelöscht.`);
      setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id));
      setDeleteTarget(null);
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
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <PackageCheck className="h-6 w-6 text-primary" />
            Inventar
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Alle Items im Katalog – mit Anmerkungen, Suche und Sortierung.
          </p>
        </div>
        {!loading && !error && (
          <Badge variant="secondary" className="w-fit">
            {items.length} Item{items.length === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      {/* Suche + Sortierung */}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Items suchen…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Sortierung</Label>
          <Select
            value={sort}
            onValueChange={(v) => setSort(v as SortOrder)}
          >
            <SelectTrigger className="w-40" aria-label="Sortierung der Items">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="az">Alphabetisch (A–Z)</SelectItem>
              <SelectItem value="za">Alphabetisch (Z–A)</SelectItem>
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
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Neues Item anlegen */}
            <form
              onSubmit={handleAdd}
              className="rounded-lg border border-dashed bg-card/50 p-3"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Neues Item (z. B. Micromops)"
                  aria-label="Name des neuen Items"
                />
                <Input
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Bemerkung (optional)"
                  aria-label="Anmerkung des neuen Items"
                />
                <Button
                  type="submit"
                  disabled={adding || !newName.trim()}
                  className="gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  {adding ? "Wird angelegt…" : "Hinzufügen"}
                </Button>
              </div>
            </form>

            {filtered.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
                {items.length === 0
                  ? "Noch keine Items im Inventar. Füge das erste Item hinzu."
                  : `Keine Items gefunden, die zu „${search}“ passen.`}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="pl-4">Item</TableHead>
                      <TableHead>Anmerkung</TableHead>
                      <TableHead className="pr-4 text-right">Aktionen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((item) => (
                      <TableRow key={item.id} className="group">
                        <TableCell className="pl-4">
                          <Input
                            defaultValue={item.name}
                            className="h-8 border-transparent bg-transparent px-2 font-medium hover:border-input focus:border-input focus:bg-background"
                            onBlur={(e) => {
                              const name = e.target.value.trim();
                              if (name && name !== item.name) {
                                void handleUpdate(item, { name });
                              } else {
                                e.target.value = item.name;
                              }
                            }}
                            aria-label={`Name von ${item.name}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            defaultValue={item.note ?? ""}
                            placeholder="–"
                            className="h-8 border-transparent bg-transparent px-2 text-muted-foreground hover:border-input focus:border-input focus:bg-background"
                            onBlur={(e) => {
                              const note = e.target.value.trim() || null;
                              if (note !== (item.note ?? null)) {
                                void handleUpdate(item, { note });
                              }
                            }}
                            aria-label={`Anmerkung zu ${item.name}`}
                          />
                        </TableCell>
                        <TableCell className="pr-4">
                          <div className="flex items-center justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              aria-label={`${item.name} löschen`}
                              onClick={() => setDeleteTarget(item)}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lösch-Bestätigung */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-primary" />
              Item löschen?
            </DialogTitle>
            <DialogDescription>
              „{deleteTarget?.name}“ wird dauerhaft aus dem Inventar entfernt.
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
