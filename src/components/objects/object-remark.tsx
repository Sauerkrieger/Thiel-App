"use client";

import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  /** Bemerkung des Objekts (null/leer = nichts anzeigen). */
  remark: string | null | undefined;
  /** Objektname für den Dialog-Titel (optional). */
  objectName?: string;
  className?: string;
};

/**
 * Anzeige der Objekt-Bemerkung: einzeilig mit „…“ gekürzt, beim Antippen
 * öffnet sich ein Dialog mit dem vollständigen Text. Stoppt die
 * Event-Propagation, damit umgebende Klick-Handler (z. B. Stopp-Zeile)
 * nicht zusätzlich ausgelöst werden.
 */
export function ObjectRemark({ remark, objectName, className }: Props) {
  const [open, setOpen] = useState(false);
  const text = remark?.trim();
  if (!text) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Bemerkung anzeigen"
        aria-label={`Bemerkung anzeigen${objectName ? ` (${objectName})` : ""}`}
        className={cn(
          // overflow-hidden + min-w-0: lange Bemerkungen bleiben auf einer
          // Zeile („…"), ohne die Zeile/Spalte aufzublähen.
          "inline-flex max-w-full items-center gap-1 overflow-hidden text-left text-xs text-muted-foreground transition-colors hover:text-foreground",
          className,
        )}
      >
        <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{text}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Bemerkung{objectName ? ` – ${objectName}` : ""}
            </DialogTitle>
          </DialogHeader>
          <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">
            {text}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
