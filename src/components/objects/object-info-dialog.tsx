"use client";

import {
  Calendar,
  Clock,
  KeyRound,
  MapPin,
  MessageSquareText,
  Pencil,
  Store,
  Trash2,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cleanAddressLabel } from "@/lib/address";
import type { ObjectWithItems } from "@/types/api";

type Props = {
  open: boolean;
  object: ObjectWithItems | null;
  isAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  /** Admin: Objekt im Bearbeiten-Dialog öffnen. */
  onEdit: (object: ObjectWithItems) => void;
  /** Admin: Lösch-Bestätigung öffnen. */
  onDelete: (object: ObjectWithItems) => void;
};

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm">{value}</p>
      </div>
    </div>
  );
}

export function ObjectInfoDialog({ open, object, isAdmin, onOpenChange, onEdit, onDelete }: Props) {
  const deliveryItems =
    object && Array.isArray(object.last_delivery_items)
      ? (object.last_delivery_items as Array<{ item_name?: string; quantity?: number; note?: string | null }>)
      : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <span className="min-w-0">{object?.name}</span>
            {object && (
              <Badge variant={object.category === "objekt" ? "secondary" : "outline"}>
                <Store className="mr-1 h-3 w-3" />
                {object.category === "objekt" ? "Objekt" : "Treppenhaus"}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {object && (
          <div className="space-y-4 text-sm">
            <div className="space-y-3">
              <InfoRow
                icon={<MapPin className="h-4 w-4" />}
                label="Adresse"
                value={cleanAddressLabel(object.address) || "–"}
              />
              {object.key_number != null && (
                <InfoRow
                  icon={<KeyRound className="h-4 w-4" />}
                  label="Schlüssel-Nummer"
                  value={<span className="font-medium tabular-nums">Nr. {object.key_number}</span>}
                />
              )}
              {object.opens_at && (
                <InfoRow
                  icon={<Clock className="h-4 w-4" />}
                  label="Öffnet ab"
                  value={`${object.opens_at.slice(0, 5)} Uhr`}
                />
              )}
              {object.remark && (
                <InfoRow
                  icon={<MessageSquareText className="h-4 w-4" />}
                  label="Bemerkung"
                  value={<span className="whitespace-pre-wrap">{object.remark}</span>}
                />
              )}
            </div>

            {/* Letzte Belieferung */}
            {object.last_delivery_at && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Letzte Belieferung
                </p>
                <div className="space-y-1.5">
                  <InfoRow
                    icon={<Calendar className="h-4 w-4" />}
                    label="Datum"
                    value={`${new Date(object.last_delivery_at).toLocaleDateString("de-DE", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}, ${new Date(object.last_delivery_at).toLocaleTimeString("de-DE", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })} Uhr`}
                  />
                  <InfoRow
                    icon={<User className="h-4 w-4" />}
                    label="Fahrer"
                    value={object.last_delivery_driver_name ?? "Unbekannt"}
                  />
                  {deliveryItems.length > 0 && (
                    <div className="pt-1">
                      <p className="mb-1 text-xs text-muted-foreground">Gelieferte Items:</p>
                      <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                        {deliveryItems.map((item, i) => (
                          <li key={i}>
                            {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ""}
                            {item.item_name ?? "Unbekanntes Item"}
                            {item.note ? ` (${item.note})` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Admin-Info: nur für Admins sichtbar */}
            {isAdmin && (object.customer || object.customer_number || object.cleaning_interval) && (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Admin-Info
                </p>
                {object.customer && <InfoRow icon={<Store className="h-4 w-4" />} label="Kunde" value={object.customer} />}
                {object.customer_number && (
                  <InfoRow icon={<KeyRound className="h-4 w-4" />} label="Kundennummer" value={object.customer_number} />
                )}
                {object.cleaning_interval && (
                  <InfoRow icon={<Calendar className="h-4 w-4" />} label="Reinigungsturnus" value={object.cleaning_interval} />
                )}
              </div>
            )}
          </div>
        )}

        {/* Bearbeiten/Löschen nur für Admins */}
        {isAdmin && object && (
          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(object)}
            >
              <Trash2 />
              Löschen
            </Button>
            <Button onClick={() => onEdit(object)}>
              <Pencil />
              Bearbeiten
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
