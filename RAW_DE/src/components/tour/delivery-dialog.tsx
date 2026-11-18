"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  Image,
  ListChecks,
  MessageSquareText,
  PackageCheck,
  Truck,
  XCircle,
} from "lucide-react";
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
import { NavigateButton } from "./navigate-button";
import { ListStatus } from "@/components/list-status";
import { offlineFetch } from "@/lib/offline/fetch";
import { useItemList } from "@/lib/use-item-list";
import type { ObjectItem } from "@/types/database";
import type { DeliveryItem, PackInfo, TourStopWithObject } from "@/types/api";

type Props = {
  open: boolean;
  tourId: string;
  stop: TourStopWithObject | null;
  onOpenChange: (open: boolean) => void;
  /** Wird nach erfolgreichem „Beliefern fertig“ aufgerufen. */
  onDelivered: () => void;
  /**
   * Optimistische Änderung: Die Tour-Liste zeigt den neuen Stand sofort,
   * während die Änderung im Hintergrund gespeichert wird.
   */
  onStopChanged?: (stopId: string, patch: Partial<TourStopWithObject>) => void;
};

/**
 * Tabellen-Rahmen für die Item-Listen (Item (Bemerkung) | Anzahl) –
 * gleiche Darstellung wie im Pack-Modus.
 */
function buildDeliveredSnapshot(
  items: ObjectItem[],
  previousExtras: DeliveryItem[],
) {
  const dueNames = new Set(previousExtras.map((item) => item.item_name));
  const snapshot = items
    .filter(
      (item) =>
        item.is_always_required ||
        item.is_reserved ||
        dueNames.has(item.item_name),
    )
    .map((item) => ({
      item_name: item.item_name,
      quantity: item.quantity ?? 1,
      note: item.note ?? null,
    }));

  // Auch ein inzwischen aus dem Katalog entferntes, zuvor vorgemerktes Item
  // gehört zur tatsächlichen Lieferung und bleibt in der Historie sichtbar.
  for (const extra of previousExtras) {
    if (!snapshot.some((item) => item.item_name === extra.item_name)) {
      snapshot.push({
        item_name: extra.item_name,
        quantity: 1,
        note: extra.note ?? null,
      });
    }
  }
  return snapshot;
}

function ItemsTable({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border">
      <Table className="table-fixed">
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
  onStopChanged,
}: Props) {
  const objectId = stop?.object?.id ?? null;
  // Nur aktuelle Daten: Items + letzte Vormerkung kommen vom Server, der
  // Offline-Cache ist reiner Fallback (mit Zeitstempel).
  const list = useItemList<PackInfo>(
    open && objectId
      ? `/api/objects/${objectId}/pack-info?exclude_tour=${encodeURIComponent(tourId)}`
      : null,
    (body) => body as unknown as PackInfo,
    "delivery-dialog",
  );
  const items = list.data?.items ?? [];
  const previousExtras = list.data?.previous_extras ?? [];
  const loading = list.loading;
  /** Items, die für die NÄCHSTE Belieferung vorgemerkt sind. */
  const [extras, setExtras] = useState<DeliveryItem[]>([]);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  /** „Nicht lieferbar“-Eingabe: Formular sichtbar + eingegebener Grund. */
  const [undeliverableMode, setUndeliverableMode] = useState(false);
  const [undeliverableReason, setUndeliverableReason] = useState("");

  // Vormerkungen aus dem letzten Stopp + reservierte Katalog-Items übernehmen,
  // sobald der Server-Stand da ist (nur einmal pro Öffnen/Stopp).
  const extrasSourceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !stop) {
      extrasSourceRef.current = null;
      return;
    }
    const source = `${stop.id}:${list.data ? "data" : "stop"}`;
    if (extrasSourceRef.current === source) return;
    extrasSourceRef.current = source;
    const reservedNames = new Set(
      (list.data?.items ?? [])
        .filter((item) => item.is_reserved && !item.is_always_required)
        .map((item) => item.item_name),
    );
    const merged = [...(stop.next_delivery_items ?? [])];
    for (const name of reservedNames) {
      if (!merged.some((entry) => entry.item_name === name)) {
        merged.push({ item_name: name, note: null });
      }
    }
    setExtras(merged);
  }, [open, stop, list.data]);

  // Bei Stopp-Wechsel die „Nicht lieferbar“-Eingabe zurücksetzen.
  useEffect(() => {
    setUndeliverableMode(false);
    setUndeliverableReason(stop?.undeliverable_reason ?? "");
  }, [stop]);

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

  /** Zeigt eine Stopp-Änderung sofort an (optimistisch). */
  function applyLocal(patch: Partial<TourStopWithObject>) {
    if (!stop) return;
    onStopChanged?.(stop.id, patch);
  }

  /**
   * Optimistisches Speichern: Der neue Stand ist sofort sichtbar, der Dialog
   * schließt sofort, die Anfrage läuft im Hintergrund. Schlägt sie fehl, wird
   * der vorherige Stand wiederhergestellt (offline landet sie in der Queue
   * und wird beim nächsten Sync nachgereicht).
   */
  async function saveStopChange(options: {
    patch: Record<string, unknown>;
    optimistic: Partial<TourStopWithObject>;
    success: string;
    rollback: Partial<TourStopWithObject>;
  }) {
    if (!stop) return;
    applyLocal(options.optimistic);
    onOpenChange(false);
    toast.success(options.success);
    try {
      const res = await offlineFetch(`/api/tours/${tourId}/stops/${stop.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        applyLocal(options.rollback);
        toast.error(body.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      // Server-Stand leise nachziehen (kein Skeleton, kein Sprung).
      onDelivered();
    } catch {
      applyLocal(options.rollback);
      toast.error("Speichern fehlgeschlagen.");
    }
  }

  function handleDeliver() {
    if (!stop) return;
    const name = stop.object?.name ?? "Unbekanntes Objekt";
    const deliveredItems = stop.is_delivered
      ? null
      : buildDeliveredSnapshot(items, previousExtras);
    const payload = {
      is_delivered: true,
      next_delivery_items: extras,
      ...(deliveredItems ? { delivered_items: deliveredItems } : {}),
    };
    void saveStopChange({
      patch: payload,
      optimistic: payload,
      success: `„${name}“ als beliefert markiert.`,
      rollback: {
        is_delivered: stop.is_delivered,
        is_undeliverable: stop.is_undeliverable,
        undeliverable_reason: stop.undeliverable_reason ?? null,
        next_delivery_items: stop.next_delivery_items ?? [],
        delivered_items: stop.delivered_items ?? [],
      },
    });
  }

  function handleUndoDeliver() {
    if (!stop) return;
    const name = stop.object?.name ?? "Unbekanntes Objekt";
    void saveStopChange({
      patch: { is_delivered: false },
      optimistic: { is_delivered: false },
      success: `„${name}“ wieder als offen markiert.`,
      rollback: { is_delivered: true },
    });
  }

  /** Stopp als „nicht lieferbar“ markieren (optional mit Grund). */
  function handleUndeliverable() {
    if (!stop) return;
    const name = stop.object?.name ?? "Unbekanntes Objekt";
    const reason = undeliverableReason.trim() || null;
    void saveStopChange({
      patch: {
        is_delivered: false,
        is_undeliverable: true,
        undeliverable_reason: reason,
        next_delivery_items: extras,
      },
      optimistic: {
        is_delivered: false,
        is_undeliverable: true,
        undeliverable_reason: reason,
        next_delivery_items: extras,
      },
      success: `„${name}“ als nicht lieferbar markiert.`,
      rollback: {
        is_delivered: stop.is_delivered,
        is_undeliverable: false,
        undeliverable_reason: null,
      },
    });
  }

  /** „Nicht lieferbar“-Markierung aufheben (Stopp wieder offen). */
  function handleUndoUndeliverable() {
    if (!stop) return;
    const name = stop.object?.name ?? "Unbekanntes Objekt";
    void saveStopChange({
      patch: { is_undeliverable: false, undeliverable_reason: null },
      optimistic: { is_undeliverable: false, undeliverable_reason: null },
      success: `„${name}“ wieder als offen markiert.`,
      rollback: {
        is_undeliverable: true,
        undeliverable_reason: stop.undeliverable_reason ?? null,
      },
    });
  }

  const standardItems = items.filter((item) => item.is_always_required);
  const variableItems = items.filter((item) => !item.is_always_required);
  const staleExtras = previousExtras.filter(
    (e) => !items.some((item) => item.item_name === e.item_name),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-md p-4 sm:w-full sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2 pr-10">
            <ListChecks className="h-5 w-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 break-words">
              Belieferung – {stop?.object?.name ?? "Unbekanntes Objekt"}
            </span>
            <NavigateButton
              address={stop?.object?.address ?? null}
              latitude={stop?.object?.latitude ?? null}
              longitude={stop?.object?.longitude ?? null}
              label={stop?.object?.name ?? "Objekt"}
            />
          </DialogTitle>
          <DialogDescription>
            Wähle aus, welche Items bei der nächsten Belieferung mitgebracht
            werden müssen.
          </DialogDescription>
          {stop?.object?.remark && (
            <p className="flex items-start gap-1.5 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-pre-wrap">{stop.object.remark}</span>
            </p>
          )}
          {stop?.is_undeliverable && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Als nicht lieferbar markiert
                {stop.undeliverable_reason ? `: ${stop.undeliverable_reason}` : ""}
              </span>
            </p>
          )}
        </DialogHeader>

        <ListStatus
          refreshing={list.refreshing}
          offlineSince={list.offlineSince}
        />
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
                      <TableCell className="min-w-0 px-3 py-2">
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
                    const previous = previousExtras.find(
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
                          <TableCell className="min-w-0 px-3 py-2">
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
                              {previous && (
                                <Badge variant="secondary">Heute gefordert</Badge>
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
                            {previous?.note && (
                              <span className="block text-xs font-medium text-primary">
                                Info: {previous.note}
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
                                placeholder="Bemerkung (optional)"
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

        {/* „Nicht lieferbar“-Eingabe (nur bei offenen Stopps) */}
        {undeliverableMode && !stop?.is_delivered && !stop?.is_undeliverable && (
          <div className="space-y-2 rounded-md border border-dashed p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Als nicht lieferbar markieren
            </p>
            <Input
              value={undeliverableReason}
              onChange={(e) => setUndeliverableReason(e.target.value)}
              placeholder="Grund (optional), z. B. Objekt geschlossen"
              maxLength={500}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => void handleUndeliverable()}
                disabled={loading}
                className="gap-1"
              >
                <XCircle className="h-4 w-4" />
                Bestätigen
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setUndeliverableMode(false)}
                >
                Abbrechen
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          {stop?.is_delivered ? (
            <Button
              variant="ghost"
              onClick={() => void handleUndoDeliver()}
              disabled={loading}
              className="text-muted-foreground"
            >
              Als offen markieren
            </Button>
          ) : stop?.is_undeliverable ? (
            <Button
              variant="ghost"
              onClick={() => void handleUndoUndeliverable()}
              disabled={loading}
              className="text-muted-foreground"
            >
              Als offen markieren
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setUndeliverableMode((v) => !v)}
              disabled={loading}
              className="text-muted-foreground"
            >
              <XCircle className="h-4 w-4" />
              Nicht lieferbar
            </Button>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Abbrechen
            </Button>
            <Button onClick={() => handleDeliver()} className="gap-2">
              <Truck />
              {stop?.is_delivered ? "Änderungen speichern" : "Beliefern fertig"}
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
