"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Check, Image, ListChecks, PackageCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { itemPhotoUrl } from "@/lib/storage";
import type { ObjectItem } from "@/types/database";
import type { DeliveryItem, PackInfo, TourStopWithObject } from "@/types/api";

type Props = {
  open: boolean;
  tourId: string;
  stop: TourStopWithObject | null;
  onOpenChange: (open: boolean) => void;
  /** Wird nach erfolgreichem „Beliefern fertig“ aufgerufen. */
  onDelivered: () => void;
};

/**
 * Tabellen-Rahmen für die Item-Listen (Item (Bemerkung) | Anzahl) –
 * gleiche Darstellung wie im Pack-Modus.
 */
function ItemsTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-muted/40">
            <TableHead className="px-3">Item (Bemerkung)</TableHead>
            <TableHead className="px-3 text-right">Anzahl</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

export function DeliveryDialog({
  open,
  tourId,
  stop,
  onOpenChange,
  onDelivered,
}: Props) {
  const [items, setItems] = useState<ObjectItem[]>([]);
  const [previousExtras, setPreviousExtras] = useState<DeliveryItem[]>([]);
  /** Items, die für die NÄCHSTE Belieferung vorgemerkt sind. */
  const [extras, setExtras] = useState<DeliveryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!stop?.object?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/objects/${stop.object.id}/pack-info`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Items konnten nicht geladen werden.");
        return;
      }
      const info = body as PackInfo;
      setItems(info.items ?? []);
      setPreviousExtras(info.previous_extras ?? []);

      // Bereits vorgemerkte Items für die nächste Belieferung übernehmen
      // (next_delivery_items). Vormerkungen gelten genau für die nächste
      // Belieferung – Vormerkungen aus der letzten Belieferung werden nicht
      // automatisch übernommen.
      setExtras(stop.next_delivery_items ?? []);
    } catch {
      toast.error("Items konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [stop]);

  useEffect(() => {
    if (open && stop) void load();
  }, [open, stop, load]);

  function toggle(itemName: string, checked: boolean) {
    setExtras((prev) => {
      const next = prev.filter((e) => e.item_name !== itemName);
      if (checked) next.push({ item_name: itemName, note: null });
      return next;
    });
  }

  function setExtraNote(itemName: string, note: string) {
    setExtras((prev) =>
      prev.map((e) =>
        e.item_name === itemName ? { ...e, note: note || null } : e,
      ),
    );
  }

  async function handleDeliver() {
    if (!stop) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tours/${tourId}/stops/${stop.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_delivered: true,
          next_delivery_items: extras,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      toast.success(`„${stop.object?.name ?? "Unbekanntes Objekt"}" als beliefert markiert.`);
      onDelivered();
      onOpenChange(false);
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUndoDeliver() {
    if (!stop) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tours/${tourId}/stops/${stop.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_delivered: false }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      toast.success(`„${stop.object?.name ?? "Unbekanntes Objekt"}" wieder als offen markiert.`);
      onDelivered();
      onOpenChange(false);
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  const standardItems = items.filter((item) => item.is_always_required);
  const variableItems = items.filter((item) => !item.is_always_required);
  const staleExtras = previousExtras.filter(
    (e) => !items.some((item) => item.item_name === e.item_name),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            Belieferung – {stop?.object?.name ?? "Unbekanntes Objekt"}
          </DialogTitle>
          <DialogDescription>
            Standard-Items sind fest vorgesehen. Wähle aus, welche variablen
            Items bei der <strong>nächsten</strong> Belieferung mitgebracht
            werden müssen – optional mit Bemerkung.
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
                <ItemsTable>
                  {standardItems.map((item) => (
                    <TableRow
                      key={item.id}
                      className="bg-muted/40 hover:bg-muted/40"
                    >
                      <TableCell className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <Checkbox
                            checked
                            disabled
                            aria-label={`${item.item_name} (Standard)`}
                          />
                          <span className="truncate text-sm font-medium text-muted-foreground">
                            {item.item_name}
                          </span>
                          {item.photo_path && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground"
                              aria-label={`Foto von ${item.item_name} anzeigen`}
                              onClick={() => setPhotoPreview(item.photo_path)}
                            >
                              <Image className="h-4 w-4" />
                            </Button>
                          )}
                        </span>
                        {item.note && (
                          <span className="block text-xs text-muted-foreground">
                            {item.note}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          {item.quantity ?? 1}x
                          <Check className="h-4 w-4 text-success" />
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </ItemsTable>
              </div>
            )}

            {variableItems.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Für die nächste Belieferung vormerken
                </p>
                <ItemsTable>
                  {variableItems.map((item) => {
                    const extra = extras.find(
                      (e) => e.item_name === item.item_name,
                    );
                    const checked = Boolean(extra);
                    return (
                      <Fragment key={item.id}>
                        <TableRow
                          className={
                            checked
                              ? "bg-primary/5 hover:bg-primary/5"
                              : "hover:bg-accent/40"
                          }
                        >
                          <TableCell className="px-3 py-2">
                            <span className="flex items-center gap-2">
                              {/* Label: Klick auf Checkbox ODER Item-Namen schaltet um */}
                              <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(v) =>
                                    toggle(item.item_name, v === true)
                                  }
                                  aria-label={`${item.item_name} für nächste Belieferung vormerken`}
                                />
                                <span className="truncate text-sm font-medium">
                                  {item.item_name}
                                </span>
                              </label>
                              {item.photo_path && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground"
                                  aria-label={`Foto von ${item.item_name} anzeigen`}
                                  onClick={() => setPhotoPreview(item.photo_path)}
                                >
                                  <Image className="h-4 w-4" />
                                </Button>
                              )}
                              {checked && (
                                <Badge variant="success">vorgemerkt</Badge>
                              )}
                            </span>
                            {item.note && (
                              <span className="block text-xs text-muted-foreground">
                                {item.note}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
                            {item.quantity ?? 1}x
                          </TableCell>
                        </TableRow>
                        {checked && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={2} className="px-3 pb-3 pt-0">
                              <Input
                                value={extra?.note ?? ""}
                                onChange={(e) =>
                                  setExtraNote(item.item_name, e.target.value)
                                }
                                placeholder="Optionale Bemerkung (nur für die nächste Tour)…"
                                className="h-8 text-sm"
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </ItemsTable>
              </div>
            )}

            {staleExtras.length > 0 && (
              <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                <p className="mb-1 font-medium">
                  Vormerkungen aus der letzten Belieferung (nicht mehr im Katalog):
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
                Für dieses Objekt sind keine Items hinterlegt.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          {stop?.is_delivered ? (
            <Button
              variant="ghost"
              onClick={() => void handleUndoDeliver()}
              disabled={saving || loading}
              className="text-muted-foreground"
            >
              Als offen markieren
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Abbrechen
            </Button>
            <Button
              onClick={() => void handleDeliver()}
              disabled={saving || loading}
              className="gap-2"
            >
              <Truck />
              {saving
                ? "Wird gespeichert…"
                : stop?.is_delivered
                  ? "Änderungen speichern"
                  : "Beliefern fertig"}
            </Button>
          </div>
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
