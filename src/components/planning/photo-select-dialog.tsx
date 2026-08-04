"use client";

import { useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  ListChecks,
  LoaderCircle,
  MapPin,
  ScanLine,
} from "lucide-react";
import { toast } from "sonner";
import { cleanAddressLabel } from "@/lib/address";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PhotoMatch, PhotoSelectResult } from "@/types/api";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (matches: PhotoMatch[]) => void;
};

export function PhotoSelectDialog({ open, onOpenChange, onApply }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<PhotoSelectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setUploading(false);
    setResult(null);
    setError(null);
    setDragging(false);
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) resetState();
    onOpenChange(nextOpen);
  }

  function handleFile(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith("image/")) {
      toast.error("Bitte ein Bild (JPG/PNG/HEIC) auswählen.");
      return;
    }
    if (next.size > MAX_FILE_SIZE) {
      toast.error("Das Bild ist größer als 10 MB.");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setResult(null);
    setError(null);
    setPreview(URL.createObjectURL(next));
  }

  async function handleAnalyze() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/planning/photo", {
        method: "POST",
        body: formData,
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? "Analyse fehlgeschlagen.");
        return;
      }

      setResult(body as PhotoSelectResult);
    } catch {
      setError("Analyse fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setUploading(false);
    }
  }

  function handleApply() {
    if (!result || result.matches.length === 0) return;
    onApply(result.matches);
    handleClose(false);
  }

  const matched = result?.matches.length ?? 0;
  const unmatched = result?.unmatched.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            Foto-Auswahl (Tourenliste)
          </DialogTitle>
          <DialogDescription>
            Fotografiere deine ausgedruckte Tourenliste. Die KI erkennt die
            Einträge und setzt die Häkchen bei den passenden Objekten – du
            kannst danach weiter manuell anpassen.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {matched} Objekte erkannt
              </Badge>
              {unmatched > 0 && (
                <Badge variant="secondary">
                  {unmatched} Einträge nicht zugeordnet
                </Badge>
              )}
            </div>

            {matched > 0 && (
              <ul className="max-h-44 space-y-1.5 overflow-y-auto">
                {result.matches.map((match) => (
                  <li
                    key={match.object_id}
                    className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    <span className="font-medium">{match.name}</span>
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {cleanAddressLabel(match.address)}
                    </span>
                    <Badge variant="outline" className="ml-1 shrink-0">
                      {match.matched_by === "adresse"
                        ? "per Adresse"
                        : "per Name"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}

            {unmatched > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Nicht zugeordnete Einträge
                </p>
                <ul className="max-h-24 space-y-1 overflow-y-auto">
                  {result.unmatched.map((entry, i) => (
                    <li
                      key={i}
                      className="rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground"
                    >
                      {entry.name ?? entry.address}
                      {entry.name && entry.address && (
                        <span className="ml-1">({entry.address})</span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Nicht zugeordnete Objekte kannst du danach manuell anhaken.
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Beim Übernehmen wird die aktuelle Auswahl durch die erkannten
              Objekte ersetzt.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div
              role="button"
              tabIndex={0}
              aria-label="Bild auswählen oder hierher ziehen"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFile(e.dataTransfer.files?.[0] ?? null);
              }}
              className={[
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-accent/40",
              ].join(" ")}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Camera className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium">
                Bild auswählen oder hierher ziehen
              </p>
              <p className="text-xs text-muted-foreground">
                JPG, PNG oder HEIC · max. 10 MB
              </p>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {preview && (
              <div className="relative overflow-hidden rounded-md border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview}
                  alt="Vorschau der Tourenliste"
                  className="max-h-56 w-full object-contain bg-muted/30"
                />
              </div>
            )}

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button
                variant="outline"
                onClick={() => setResult(null)}
                disabled={uploading}
              >
                Anderes Bild
              </Button>
              <Button onClick={handleApply} disabled={matched === 0}>
                <CheckCircle2 />
                Auswahl übernehmen
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={uploading}
              >
                Abbrechen
              </Button>
              <Button
                onClick={() => void handleAnalyze()}
                disabled={!file || uploading}
              >
                {uploading ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    Liste wird analysiert…
                  </>
                ) : (
                  <>
                    <ScanLine />
                    Analysieren
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
