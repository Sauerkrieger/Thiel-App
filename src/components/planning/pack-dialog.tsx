"use client";

import { useCallback, useEffect, useState } from "react";
import { Image, ListChecks, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { itemPhotoUrl } from "@/lib/storage";
import type { ObjectItem } from "@/types/database";
import type { DeliveryItem, PackInfo } from "@/types/api";

type Props = {
  open: boolean;
  objectName: string | null;
  objectId: string | null;
  onOpenChange: (open: boolean) => void;
};

/**
 * Eine Zeile in der Packliste (Tabellenform: Item (Bemerkung) | Anzahl).
 * Items sind bewusst nicht änderbar (kein Checkbox/Häkchen). Hat das Item
 * ein Foto, ist die gesamte Zeile antippbar und öffnet die Foto-Vorschau.
 * Die Anzahl wird immer angezeigt – auch „1x“ bei nur einem Stück.
 */
function PackItemRow({
  item,
  extraNote,
  badge,
  onOpenPhoto,
}: {
  item: ObjectItem;
  /** Zusätzliche Bemerkung (z. B. Vormerkung aus der letzten Belieferung). */
  extraNote?: string | null;
  badge?: string;
  onOpenPhoto: (photoPath: string) => void;
}) {
  const quantity = item.quantity ?? 1;
  const hasPhoto = Boolean(item.photo_path);
  // Item- und Vormerk-Bemerkung als Zeilen; identische Einträge nur einmal.
  const notes = [
    ...new Set(
      [item.note?.trim(), extraNote?.trim()].filter(
        (n): n is string => Boolean(n),
      ),
    ),
  ];

  return (
    <TableRow
      onClick={hasPhoto ? () => onOpenPhoto(item.photo_path!) : undefined}
      aria-label={hasPhoto ? `Foto von ${item.item_name} anzeigen` : undefined}
      title={hasPhoto ? `Foto von ${item.item_name} anzeigen` : undefined}
      className={hasPhoto ? "cursor-pointer" : undefined}
    >
      <TableCell className="px-3 py-2">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{item.item_name}</span>
          {hasPhoto && (
            <Image className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          )}
          {badge && <Badge variant="secondary">{badge}</Badge>}
        </span>
        {notes.map((note, i) => (
          <span key={i} className="block text-xs text-muted-foreground">
            {note}
          </span>
        ))}
      </TableCell>
      <TableCell className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
        {quantity}x
      </TableCell>
    </TableRow>
  );
}

/**
 * Tabellen-Block (Item (Bemerkung) | Anzahl) für eine Gruppe von Items.
 * `extraNoteFor` liefert die zusätzliche Bemerkung je Item-Name (z. B.
 * Vormerkung aus der letzten Belieferung).
 */
function PackItemsTable({
  items,
  extraNoteFor,
  badge,
  onOpenPhoto,
}: {
  items: ObjectItem[];
  extraNoteFor?: (name: string) => string | null;
  badge?: string;
  onOpenPhoto: (photoPath: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-muted/40">
            <TableHead className="px-3">Item (Bemerkung)</TableHead>
            <TableHead className="px-3 text-right">Anzahl</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <PackItemRow
              key={item.id}
              item={item}
              extraNote={extraNoteFor ? extraNoteFor(item.item_name) : undefined}
              badge={badge}
              onOpenPhoto={onOpenPhoto}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function PackDialog({ open, objectName, objectId, onOpenChange }: Props) {
  const [items, setItems] = useState<ObjectItem[]>([]);
  const [previousExtras, setPreviousExtras] = useState<DeliveryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!objectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/objects/${objectId}/pack-info`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Packliste konnte nicht geladen werden.");
        return;
      }
      const info = body as PackInfo;
      setItems(info.items ?? []);
      setPreviousExtras(info.previous_extras ?? []);
    } catch {
      toast.error("Packliste konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [objectId]);

  useEffect(() => {
    if (open && objectId) void load();
  }, [open, objectId, load]);

  const standardItems = items.filter((item) => item.is_always_required);
  const previousNames = new Set(previousExtras.map((e) => e.item_name));
  // Vorgemerkte Items aus der letzten Belieferung, die noch im Katalog sind -> fest vorgesehen
  const markedItems = items.filter(
    (item) => !item.is_always_required && previousNames.has(item.item_name),
  );
  const staleExtras = previousExtras.filter(
    (e) => !items.some((item) => item.item_name === e.item_name),
  );

  const noteFor = (name: string) =>
    previousExtras.find((e) => e.item_name === name)?.note ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            Packliste – {objectName}
          </DialogTitle>
          <DialogDescription>
            Diese Items müssen mitgenommen werden.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {standardItems.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Standard-Items (immer mitnehmen)
                </p>
                <PackItemsTable
                  items={standardItems}
                  onOpenPhoto={setPhotoPreview}
                />
              </div>
            )}

            {markedItems.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Vorgemerkt – muss mitgenommen werden
                </p>
                <PackItemsTable
                  items={markedItems}
                  extraNoteFor={noteFor}
                  badge="vorgemerkt"
                  onOpenPhoto={setPhotoPreview}
                />
              </div>
            )}

            {staleExtras.length > 0 && (
              <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                <p className="mb-1 font-medium">
                  Vorgemerkt, nicht mehr im Katalog:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {staleExtras.map((e) => (
                    <Badge key={e.item_name} variant="secondary">
                      <PackageCheck className="mr-1 h-3 w-3" />
                      {e.item_name}
                      {e.note ? ` (${e.note})` : ""}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {items.length === 0 && (
              <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                Für dieses Objekt sind noch keine Items hinterlegt.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fertig
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Foto-Vorschau */}
      <Dialog open={photoPreview !== null} onOpenChange={(open) => !open && setPhotoPreview(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Item-Foto</DialogTitle>
          </DialogHeader>
          {photoPreview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={itemPhotoUrl(photoPreview) ?? ""}
              alt="Item-Foto Vorschau"
              className="max-h-[70vh] w-full rounded-md border object-contain bg-muted/30"
            />
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
