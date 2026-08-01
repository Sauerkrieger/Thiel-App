"use client";

import { useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  LoaderCircle,
  MapPin,
  ScanLine,
} from "lucide-react";
import { toast } from "sonner";
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
import type { ImportResult } from "@/types/api";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
};

export function PhotoImportDialog({ open, onOpenChange, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
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

  async function handleImport() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/objects/import", {
        method: "POST",
        body: formData,
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? "Import fehlgeschlagen.");
        return;
      }

      setResult(body as ImportResult);
      onImported();
    } catch {
      setError("Import fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setUploading(false);
    }
  }

  const created = result?.created.length ?? 0;
  const duplicates = result?.duplicates.length ?? 0;
  const failed = result?.errors.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            Foto-Import (KI)
          </DialogTitle>
          <DialogDescription>
            Fotografiere eine gedruckte Adressliste. Die KI extrahiert die
            Adressen und legt neue Objekte an – bereits vorhandene werden
            automatisch übersprungen.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border bg-success/10 p-3">
                <p className="text-2xl font-bold text-success">{created}</p>
                <p className="text-xs text-muted-foreground">neu angelegt</p>
              </div>
              <div className="rounded-md border bg-secondary p-3">
                <p className="text-2xl font-bold">{duplicates}</p>
                <p className="text-xs text-muted-foreground">übersprungen</p>
              </div>
              <div className="rounded-md border bg-destructive/5 p-3">
                <p className="text-2xl font-bold text-destructive">{failed}</p>
                <p className="text-xs text-muted-foreground">Fehler</p>
              </div>
            </div>

            {created > 0 && (
              <ul className="max-h-40 space-y-1.5 overflow-y-auto">
                {result.created.map((obj) => (
                  <li
                    key={obj.id}
                    className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    <span className="font-medium">{obj.name}</span>
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {obj.address}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {duplicates > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Bereits vorhanden – übersprungen
                </p>
                <ul className="max-h-28 space-y-1 overflow-y-auto">
                  {result.duplicates.map((dup, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground"
                    >
                      <Badge variant="secondary">Duplikat</Badge>
                      {dup.address}
                      <span className="ml-auto text-xs">→ {dup.matched}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {failed > 0 && (
              <p className="text-xs text-muted-foreground">
                {failed} Einträge konnten nicht zugeordnet werden.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div
              role="button"
              tabIndex={0}
              aria-label="Bild auswählen oder hierher ziehen"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
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
                  alt="Vorschau der hochgeladenen Adressliste"
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
            <Button onClick={() => handleClose(false)}>Fertig</Button>
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
                onClick={() => void handleImport()}
                disabled={!file || uploading}
              >
                {uploading ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    Bild wird analysiert…
                  </>
                ) : (
                  <>
                    <ScanLine />
                    Analysieren & importieren
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
