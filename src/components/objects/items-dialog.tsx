"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, ListChecks, Plus, Trash2, X } from "lucide-react";
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
import { offlineFetch } from "@/lib/offline/fetch";
import type { ObjectItem } from "@/types/database";
import type { ObjectWithItems } from "@/types/api";

type Props = {
  open: boolean;
  object: ObjectWithItems | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
};

export function ItemsDialog({ open, object, onOpenChange, onChanged }: Props) {
  const [items, setItems] = useState<ObjectItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newQuantity, setNewQuantity] = useState("1");
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [photoBusyId, setPhotoBusyId] = useState<string | null>(null);
  const photoInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const loadItems = useCallback(async () => {
    if (!object) return;
    setLoading(true);
    try {
      const res = await offlineFetch(`/api/objects/${object.id}/items`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Items konnten nicht geladen werden.");
        return;
      }
      setItems(body.items ?? []);
    } catch {
      toast.error("Items konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [object]);

  useEffect(() => {
    if (open && object) {
      setNewName("");
      setNewQuantity("1");
      setNewNote("");
      void loadItems();
    }
  }, [open, object, loadItems]);

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
        toast.error(body.error ?? "Item konnte nicht angelegt werden.");
        return;
      }
      setNewName("");
      setNewQuantity("1");
      setNewNote("");
      await loadItems();
      onChanged();
    } catch {
      toast.error("Item konnte nicht angelegt werden.");
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
        toast.error(body.error ?? "Änderung fehlgeschlagen.");
        return;
      }
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)),
      );
      onChanged();
    } catch {
      toast.error("Änderung fehlgeschlagen.");
    }
  }

  /** Foto eines Items hochladen (öffentlicher Storage-Bucket). */
  async function handleItemPhoto(item: ObjectItem, file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Bitte ein Bild (JPG/PNG/WEBP/HEIC) auswählen.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Das Bild ist größer als 10 MB.");
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
        toast.error(body.error ?? "Foto konnte nicht hochgeladen werden.");
        return;
      }
      await handleUpdate(item, { photo_path: body.photo_path });
      toast.success("Foto hochgeladen.");
    } catch {
      toast.error("Foto konnte nicht hochgeladen werden.");
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
        toast.error(body.error ?? "Löschen fehlgeschlagen.");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      onChanged();
    } catch {
      toast.error("Löschen fehlgeschlagen.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            Items – {object?.name}
          </DialogTitle>
          <DialogDescription>
            Je Item: Menge, Bezeichnung und optionale Bemerkung. „Standard“ ist
            bei jeder Belieferung fest vorgesehen. „Vormerken" markiert ein Nicht-Standard-Item einmalig für die nächste Belieferung.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Noch keine Items. Füge das erste Item hinzu.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-md border bg-card p-2.5"
                >
                  <div className="flex items-center gap-2">
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
                          ? `${item.item_name} als Standard entfernen`
                          : `${item.item_name} als Standard markieren`
                      }
                    />
                    {item.is_always_required ? (
                      <Badge variant="success">Standard</Badge>
                    ) : (
                      <>
                        <Checkbox
                          checked={item.is_reserved}
                          onCheckedChange={() =>
                            void handleUpdate(item, {
                              is_reserved: !item.is_reserved,
                            })
                          }
                          aria-label={
                            item.is_reserved
                              ? `${item.item_name} Vormerkung aufheben`
                              : `${item.item_name} für nächste Belieferung vormerken`
                          }
                        />
                        {item.is_reserved && (
                          <Badge variant="outline">vorgemerkt</Badge>
                        )}
                      </>
                    )}
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      aria-label={`${item.item_name} löschen`}
                      onClick={() => void handleDelete(item)}
                    >
                      <Trash2 />
                    </Button>
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
                      aria-label={`Menge für ${item.item_name}`}
                    />
                    <Input
                      defaultValue={item.item_name}
                      onBlur={(e) => {
                        const trimmed = e.target.value.trim();
                        if (trimmed && trimmed !== item.item_name) {
                          void handleUpdate(item, { item_name: trimmed });
                        }
                      }}
                      aria-label={`Bezeichnung für ${item.item_name}`}
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      className="flex-1"
                      defaultValue={item.note ?? ""}
                      placeholder="Bemerkung (optional)"
                      onBlur={(e) => {
                        const note = e.target.value.trim() || null;
                        if (note !== (item.note ?? null)) {
                          void handleUpdate(item, { note });
                        }
                      }}
                      aria-label={`Bemerkung für ${item.item_name}`}
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
                      aria-label={`Foto für ${item.item_name}`}
                    />
                    {item.photo_path ? (
                      <span className="relative shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={itemPhotoUrl(item.photo_path) ?? ""}
                          alt={`Foto für ${item.item_name}`}
                          className="h-9 w-9 rounded-md border object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => void handleUpdate(item, { photo_path: null })}
                          aria-label="Foto entfernen"
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
                        aria-label={`Foto für ${item.item_name} hochladen`}
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
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAdd} className="space-y-2 rounded-md border border-dashed p-2.5">
            <div className="grid grid-cols-[5.5rem_1fr] gap-2">
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                placeholder="Menge"
                aria-label="Menge neues Item"
              />
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Bezeichnung (z. B. Micromops)"
                aria-label="Bezeichnung neues Item"
              />
            </div>
            <Input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Bemerkung (optional)"
              aria-label="Bemerkung neues Item"
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              disabled={adding || !newName.trim()}
            >
              <Plus className="h-4 w-4" />
              Hinzufügen
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
