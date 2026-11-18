"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, KeyRound, ListChecks, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatItemLabel } from "@/lib/items";
import { itemPhotoUrl } from "@/lib/storage";
import { ListStatus } from "@/components/list-status";
import { offlineFetch } from "@/lib/offline/fetch";
import { useItemList } from "@/lib/use-item-list";
import type { ObjectItem } from "@/types/database";
import type { ObjectWithItems } from "@/types/api";

type Props = {
  open: boolean;
  object: ObjectWithItems | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  /** Löschen ist Admins vorbehalten – ohne diese Rechte wird der Button ausgeblendet. */
  canDelete?: boolean;
  /** Reine Lesansicht (Reinigungskraft): keine Bearbeitung/Änderung möglich. */
  readOnly?: boolean;
};

/**
 * Sortiert Items wie die Items-API (GET /api/objects/[id]/items):
 * Standard-Items zuerst, innerhalb gleicher Priorität die ältesten zuerst.
 * Dadurch sieht die sofort angezeigte Cache-Liste genauso aus wie die
 * nachgeladene Server-Liste (kein sichtbares Umspringen beim Refresh).
 */
function sortItemsForDisplay(items: ObjectItem[]): ObjectItem[] {
  return [...items].sort((a, b) => {
    if (a.is_always_required !== b.is_always_required) {
      return a.is_always_required ? -1 : 1;
    }
    return a.created_at.localeCompare(b.created_at);
  });
}

export function ItemsDialog({ open, object, onOpenChange, onChanged, canDelete = true, readOnly = false }: Props) {
  // Nur aktuelle Daten: der Server liefert die Item-Liste, der Offline-Cache
  // ist reiner Fallback (mit Zeitstempel). Beim Laden dreht ein Spinner.
  const list = useItemList<ObjectItem[]>(
    open && object ? `/api/objects/${object.id}/items` : null,
    (body) => sortItemsForDisplay((body.items ?? []) as ObjectItem[]),
    "items-dialog",
  );
  const items = list.data ?? [];
  const loading = list.loading;
  const [newQuantity, setNewQuantity] = useState("1");
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [photoBusyId, setPhotoBusyId] = useState<string | null>(null);
  const photoInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Beim Öffnen/Objektwechsel das Eingabeformular zurücksetzen.
  useEffect(() => {
    if (open && object) {
      setNewName("");
      setNewQuantity("1");
      setNewNote("");
    }
  }, [open, object]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!object || !newName.trim()) return;
    setAdding(true);
    try {
      const res = await offlineFetch(`/api/objects/${object.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_name: newName.trim(),
          quantity: Number.parseInt(newQuantity, 10) || 1,
          note: newNote.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Could not create item.");
        return;
      }
      setNewName("");
      setNewQuantity("1");
      setNewNote("");
      await list.refresh({ quiet: true });
      onChanged();
    } catch {
      toast.error("Could not create item.");
    } finally {
      setAdding(false);
    }
  }

  /** Einzelnes Feld eines Items aktualisieren (Inline-Edit). */
  async function handleUpdate(item: ObjectItem, patch: Partial<ObjectItem>) {
    if (!object) return;
    try {
      const res = await offlineFetch(
        `/api/objects/${object.id}/items/${item.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Update failed.");
        return;
      }
      list.update((prev) =>
        (prev ?? []).map((i) => (i.id === item.id ? { ...i, ...patch } : i)),
      );
      onChanged();
    } catch {
      toast.error("Update failed.");
    }
  }

  /** Foto eines Items hochladen (öffentlicher Storage-Bucket). */
  async function handleItemPhoto(item: ObjectItem, file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image (JPG/PNG/WEBP/HEIC).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("The image is larger than 10 MB.");
      return;
    }
    setPhotoBusyId(item.id);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/items/photo", {
        method: "POST",
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Could not upload the photo.");
        return;
      }
      await handleUpdate(item, { photo_path: body.photo_path });
      toast.success("Photo uploaded.");
    } catch {
      toast.error("Could not upload the photo.");
    } finally {
      setPhotoBusyId(null);
    }
  }

  async function handleDelete(item: ObjectItem) {
    if (!object) return;
    try {
      const res = await offlineFetch(
        `/api/objects/${object.id}/items/${item.id}`,
        { method: "DELETE" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Delete failed.");
        return;
      }
      list.update((prev) => (prev ?? []).filter((i) => i.id !== item.id));
      onChanged();
    } catch {
      toast.error("Delete failed.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            Items – {object?.name}
            {object?.key_number != null && (
              <span className="inline-flex items-center gap-1 text-sm font-medium tabular-nums text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5" />
                No. {object.key_number}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? "Read-only view: the item list of this object."
              : "Per item: quantity, description and an optional note. “Standard” is always included in every delivery. “Reserve” marks a non-standard item once for the next delivery."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <ListStatus
            refreshing={list.refreshing}
            offlineSince={list.offlineSince}
          />
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {readOnly ? "No items yet." : "No items yet. Add the first item."}
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-md border bg-card p-2.5"
                >
                  {readOnly ? (
                    /* Nur-Lese-Ansicht: ohne Bearbeitungssteuerung */
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium tabular-nums">
                        {item.quantity && item.quantity > 1 ? `${item.quantity}× ` : ""}
                        {item.item_name}
                      </span>
                      {/* Reinigungskraft (Nur-Lese): kein „Standard“-Badge */}
                      {item.is_reserved && !item.is_always_required && (
                        <Badge variant="outline">reserved</Badge>
                      )}
                      {item.note && (
                        <span className="text-sm text-muted-foreground">({item.note})</span>
                      )}
                      {item.photo_path && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={itemPhotoUrl(item.photo_path) ?? ""}
                          alt={`Photo of ${item.item_name}`}
                          className="h-9 w-9 rounded-md border object-cover"
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <label
                          className={[
                            "flex cursor-pointer items-center gap-1.5 text-xs font-medium transition-colors",
                            item.is_always_required
                              ? "text-primary"
                              : "text-muted-foreground hover:text-foreground",
                          ].join(" ")}
                        >
                          <Checkbox
                            checked={item.is_always_required}
                            onCheckedChange={() =>
                              void handleUpdate(item, {
                                is_always_required: !item.is_always_required,
                                ...(item.is_always_required ? {} : { is_reserved: false }),
                              })
                            }
                            aria-label={
                              item.is_always_required
                                ? `Remove ${item.item_name} as default`
                                : `Mark ${item.item_name} as default`
                            }
                          />
                          Standard
                        </label>
                        {!item.is_always_required && (
                          <label
                            className={[
                              "flex cursor-pointer items-center gap-1.5 text-xs font-medium transition-colors",
                              item.is_reserved
                                ? "text-primary"
                                : "text-muted-foreground hover:text-foreground",
                            ].join(" ")}
                          >
                            <Checkbox
                              checked={item.is_reserved}
                              onCheckedChange={() =>
                                void handleUpdate(item, {
                                  is_reserved: !item.is_reserved,
                                })
                              }
                              aria-label={
                                item.is_reserved
                                  ? `Clear reservation for ${item.item_name}`
                                  : `Reserve ${item.item_name} for the next delivery`
                              }
                            />
                            Vormerken
                          </label>
                        )}
                        <div className="flex-1" />
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${item.item_name}`}
                            onClick={() => void handleDelete(item)}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-[5.5rem_1fr] gap-2">
                        <Input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          defaultValue={String(item.quantity ?? 1)}
                          onBlur={(e) => {
                            const parsed = Number.parseInt(e.target.value, 10);
                            const quantity = Number.isInteger(parsed) && parsed > 0
                              ? parsed
                              : item.quantity ?? 1;
                            if (quantity !== item.quantity) {
                              void handleUpdate(item, { quantity });
                            }
                          }}
                          aria-label={`Quantity for ${item.item_name}`}
                        />
                        <Input
                          defaultValue={item.item_name}
                          onBlur={(e) => {
                            const trimmed = e.target.value.trim();
                            if (trimmed && trimmed !== item.item_name) {
                              void handleUpdate(item, { item_name: trimmed });
                            }
                          }}
                          aria-label={`Description for ${item.item_name}`}
                        />
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Input
                          className="flex-1"
                          defaultValue={item.note ?? ""}
                          placeholder="Note (optional)"
                          onBlur={(e) => {
                            const note = e.target.value.trim() || null;
                            if (note !== (item.note ?? null)) {
                              void handleUpdate(item, { note });
                            }
                          }}
                          aria-label={`Note for ${item.item_name}`}
                        />
                        <input
                          ref={(el) => {
                            if (el) photoInputRefs.current.set(item.id, el);
                            else photoInputRefs.current.delete(item.id);
                          }}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => {
                            void handleItemPhoto(item, e.target.files?.[0] ?? null);
                            e.target.value = "";
                          }}
                          aria-label={`Photo of ${item.item_name}`}
                        />
                        {item.photo_path ? (
                          <span className="relative shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={itemPhotoUrl(item.photo_path) ?? ""}
                              alt={`Photo of ${item.item_name}`}
                              className="h-9 w-9 rounded-md border object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => void handleUpdate(item, { photo_path: null })}
                              aria-label="Remove photo"
                              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                            aria-label={`Upload photo of ${item.item_name}`}
                            disabled={photoBusyId === item.id}
                            onClick={() => photoInputRefs.current.get(item.id)?.click()}
                          >
                            <ImagePlus className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Anzeige: {formatItemLabel(item)}
                      </p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!readOnly && (
          <form onSubmit={handleAdd} className="space-y-2 rounded-md border border-dashed p-2.5">
            <div className="grid grid-cols-[5.5rem_1fr] gap-2">
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                placeholder="Quantity"
                aria-label="New item quantity"
              />
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name (e.g. Micromops)"
                aria-label="Name for new item"
              />
            </div>
            <Input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Note (optional)"
              aria-label="Note for new item"
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              disabled={adding || !newName.trim()}
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
