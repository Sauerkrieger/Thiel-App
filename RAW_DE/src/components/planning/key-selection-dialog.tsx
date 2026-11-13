"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OptimizedStop } from "@/types/api";

type Props = {
  open: boolean;
  stops: OptimizedStop[];
  selectedStopIds: Set<string>;
  onOpenChange: (open: boolean) => void;
  onConfirm: (selectedStopIds: Set<string>) => void;
};

export function KeySelectionDialog({
  open,
  stops,
  selectedStopIds,
  onOpenChange,
  onConfirm,
}: Props) {
  const keyStops = stops.filter(
    (stop) => !stop.is_unknown && stop.key_number != null,
  );
  const [draft, setDraft] = useState<Set<string>>(selectedStopIds);

  useEffect(() => {
    if (open) setDraft(new Set(selectedStopIds));
  }, [open, selectedStopIds]);

  function toggle(stopId: string, checked: boolean) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (checked) next.add(stopId);
      else next.delete(stopId);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Schlüssel auswählen
          </DialogTitle>
          <DialogDescription>
            Wähle die Schlüssel aus, die du auf diese Tour mitnehmen möchtest.
          </DialogDescription>
        </DialogHeader>

        {keyStops.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Für diese Tour sind keine Schlüssel hinterlegt.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {keyStops.map((stop) => {
              const checked = draft.has(stop.object_id);
              return (
                <li key={stop.object_id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 hover:bg-accent/40">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        toggle(stop.object_id, value === true)
                      }
                      aria-label={`${stop.name}, Nr. ${stop.key_number} auswählen`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {stop.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Nr. {stop.key_number}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            onClick={() => {
              onConfirm(new Set(draft));
              onOpenChange(false);
            }}
          >
            Bestätigen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
