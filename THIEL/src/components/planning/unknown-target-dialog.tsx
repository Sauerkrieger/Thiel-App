"use client";

import { useEffect, useState } from "react";
import { MapPin, Navigation, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AddressAutocomplete } from "@/components/objects/address-autocomplete";
import type { AddressSuggestion } from "@/app/api/geocoding/autocomplete/route";
import type { UnknownTarget } from "@/types/api";

/** Aus dem Dialog übernommene Adresse (nur aus gültigen Vorschlägen). */
export type UnknownTargetAddress = {
  address: string;
  latitude: number | null;
  longitude: number | null;
};

type Props = {
  open: boolean;
  target: UnknownTarget | null;
  onOpenChange: (open: boolean) => void;
  onSave: (value: UnknownTargetAddress) => void;
  onDelete?: () => void;
};

export function UnknownTargetDialog({
  open,
  target,
  onOpenChange,
  onSave,
  onDelete,
}: Props) {
  const [address, setAddress] = useState("");
  /** Nur eine aus den Vorschlägen gewählte Adresse ist gültig (exakte
   *  Schreibweise + verifizierte Koordinaten für die Routenberechnung). */
  const [selected, setSelected] = useState<{
    label: string;
    latitude: number | null;
    longitude: number | null;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setAddress(target?.address ?? "");
      // Bereits gespeicherte Adresse gilt als gültig (sie stammt aus einer
      // früheren Vorschlags-Auswahl) – Speichern ohne neue Auswahl möglich.
      setSelected(
        target?.address
          ? {
              label: target.address,
              latitude: target.latitude ?? null,
              longitude: target.longitude ?? null,
            }
          : null,
      );
    }
  }, [open, target]);

  function handleSelect(suggestion: AddressSuggestion) {
    setSelected({
      label: suggestion.label,
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
    });
    setAddress(suggestion.label);
  }

  function handleChange(value: string) {
    setAddress(value);
    // Weiteres Tippen nach einer Auswahl invalidiert die Auswahl.
    if (selected && value !== selected.label) setSelected(null);
  }

  function handleSave() {
    if (!selected || address.trim() !== selected.label) {
      toast.error("Bitte wähle eine Adresse aus den Vorschlägen aus.");
      return;
    }
    onSave({
      address: selected.label,
      latitude: selected.latitude,
      longitude: selected.longitude,
    });
    onOpenChange(false);
  }

  function openInMaps() {
    // Öffnet nur Google Maps – ohne Adresse/Query (siehe Anforderung:
    // einfach nur Maps öffnen, nichts vorausfüllen).
    window.open("https://www.google.com/maps", "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !address.trim() && onDelete) {
          onDelete();
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            {target?.name ?? "Unbekanntes Ziel"}
          </DialogTitle>
          <DialogDescription>
            Wähle die Adresse aus den Vorschlägen aus – nur ausgewählte
            Adressen können gespeichert werden.
          </DialogDescription>
        </DialogHeader>

        {/* Maps-Link direkt neben der Eingabe (auch auf dem Handy) */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <AddressAutocomplete
              value={address}
              onChange={handleChange}
              onSelect={handleSelect}
              placeholder="Adresse eingeben…"
              autoFocus
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={openInMaps}
            aria-label="Google Maps öffnen"
            title="Google Maps öffnen"
          >
            <Navigation className="h-4 w-4" />
          </Button>
        </div>

        <DialogFooter className="sm:justify-between">
          {onDelete ? (
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                onDelete();
                onOpenChange(false);
              }}
            >
              <Trash2 />
              Löschen
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSave}>Speichern</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
