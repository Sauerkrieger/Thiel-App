"use client";

import { useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  KeyRound,
  ListChecks,
  LoaderCircle,
  MapPin,
  Plus,
  ScanLine,
  Store,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ObjectCategory } from "@/types/database";
import type {
  ImportResult,
  ItemGroupImportPreview,
  ItemGroupImportResult,
  KeyImportPreview,
  KeyImportResult,
  ObjectImportPreview,
} from "@/types/api";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

type Mode = "objects" | "keys" | "items";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
};

/** Aus der Schlüssel-Vorauswahl bestätigbare Zuordnung (Objekt wählbar). */
type KeySelection = {
  object_id: string;
  object_name: string;
  address: string;
  key_number: number;
  already_has_key: boolean;
  selected: boolean;
};

/** Bearbeitbares Objekt in der Objekt-Vorauswahl. */
type ObjectSelection = {
  name: string;
  address: string;
  category: ObjectCategory;
  is_pedestrian_zone_until_11: boolean;
  opens_at: string;
  selected: boolean;
  is_duplicate: boolean;
  /** Koordinaten des ORS-Treffers (null = nicht verifiziert / geändert). */
  latitude: number | null;
  longitude: number | null;
  /** Ob ORS die Adresse auflösen konnte (für das Badge). */
  geocoding_status: "ok" | "not_found";
};

/** Bearbeitbares Item innerhalb einer Items-Gruppe. */
type ItemDraft = {
  item_name: string;
  quantity: string;
  note: string;
};

/** Aus der Items-Vorauswahl bestätigbare Gruppe. */
type ItemSelection = {
  object_id: string;
  object_name: string;
  address: string | null;
  items: ItemDraft[];
  selected: boolean;
};

const MODE_OPTIONS: {
  mode: Mode;
  icon: typeof ScanLine;
  title: string;
  description: string;
}[] = [
  {
    mode: "objects",
    icon: Store,
    title: "Objekte",
    description: "Adressliste fotografieren – neue Objekte anlegen.",
  },
  {
    mode: "keys",
    icon: KeyRound,
    title: "Schlüssel",
    description: "Schlüsselliste mit Objektnamen – Nummern zuordnen.",
  },
  {
    mode: "items",
    icon: ListChecks,
    title: "Items",
    description: "Packliste mit Objektnamen – Items zuordnen.",
  },
];

export function PhotoImportDialog({ open, onOpenChange, onImported }: Props) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ergebnisse / Vorauswahlen je Modus
  const [objectPreview, setObjectPreview] = useState<ObjectImportPreview | null>(null);
  const [objectSelections, setObjectSelections] = useState<ObjectSelection[]>([]);
  const [objectResult, setObjectResult] = useState<ImportResult | null>(null);
  const [keyPreview, setKeyPreview] = useState<KeyImportPreview | null>(null);
  const [keySelections, setKeySelections] = useState<KeySelection[]>([]);
  const [keyResult, setKeyResult] = useState<KeyImportResult | null>(null);
  const [itemPreview, setItemPreview] = useState<ItemGroupImportPreview | null>(null);
  const [itemSelections, setItemSelections] = useState<ItemSelection[]>([]);
  const [itemResult, setItemResult] = useState<ItemGroupImportResult | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    if (preview) URL.revokeObjectURL(preview);
    setMode(null);
    setFile(null);
    setPreview(null);
    setBusy(false);
    setApplying(false);
    setError(null);
    setObjectPreview(null);
    setObjectSelections([]);
    setObjectResult(null);
    setKeyPreview(null);
    setKeySelections([]);
    setKeyResult(null);
    setItemPreview(null);
    setItemSelections([]);
    setItemResult(null);
    setDragging(false);
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) resetState();
    onOpenChange(nextOpen);
  }

  function pickMode(next: Mode) {
    setMode(next);
    setObjectPreview(null);
    setObjectSelections([]);
    setObjectResult(null);
    setKeyPreview(null);
    setKeyResult(null);
    setItemPreview(null);
    setItemResult(null);
    setError(null);
  }

  function backToUpload() {
    setObjectPreview(null);
    setObjectSelections([]);
    setObjectResult(null);
    setKeyPreview(null);
    setKeyResult(null);
    setItemPreview(null);
    setItemResult(null);
    setError(null);
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
    setPreview(URL.createObjectURL(next));
    setObjectPreview(null);
    setObjectSelections([]);
    setObjectResult(null);
    setKeyPreview(null);
    setKeyResult(null);
    setItemPreview(null);
    setItemResult(null);
    setError(null);
  }

  /** Schritt 1: Bild analysieren (Modus-abhängig) – schreibt noch nichts. */
  async function handleAnalyze() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      if (mode === "keys") {
        const res = await fetch("/api/objects/import/keys/analyze", {
          method: "POST",
          body: formData,
        });
        const body = await res.json();
        if (!res.ok) {
          setError(body.error ?? "Analyse fehlgeschlagen.");
          return;
        }
        const previewData = body as KeyImportPreview;
        setKeyPreview(previewData);
        setKeySelections(
          previewData.matches.map((m) => ({
            object_id: m.object_id,
            object_name: m.object_name,
            address: m.address,
            key_number: m.key_number,
            already_has_key: m.already_has_key,
            selected: !m.already_has_key,
          })),
        );
      } else if (mode === "items") {
        const res = await fetch("/api/objects/import/items/analyze", {
          method: "POST",
          body: formData,
        });
        const body = await res.json();
        if (!res.ok) {
          setError(body.error ?? "Analyse fehlgeschlagen.");
          return;
        }
        const previewData = body as ItemGroupImportPreview;
        setItemPreview(previewData);
        setItemSelections(
          previewData.matches.map((m) => ({
            object_id: m.object_id,
            object_name: m.object_name,
            address: m.address,
            items: m.items.map((i) => ({
              item_name: i.item_name,
              quantity: String(i.quantity),
              note: i.note ?? "",
            })),
            selected: true,
          })),
        );
      } else {
        // Objekte: erst Vorschau, danach bestätigen.
        const res = await fetch("/api/objects/import/objects/analyze", {
          method: "POST",
          body: formData,
        });
        const body = await res.json();
        if (!res.ok) {
          setError(body.error ?? "Analyse fehlgeschlagen.");
          return;
        }
        const previewData = body as ObjectImportPreview;
        setObjectPreview(previewData);
        setObjectSelections(
          previewData.objects.map((o) => ({
            name: o.name,
            address: o.address,
            category: o.category,
            is_pedestrian_zone_until_11: o.is_pedestrian_zone_until_11,
            opens_at: o.opens_at ?? "",
            selected: !o.is_duplicate,
            is_duplicate: o.is_duplicate,
            latitude: o.latitude,
            longitude: o.longitude,
            geocoding_status: o.geocoding_status,
          })),
        );
      }
    } catch {
      setError("Analyse fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }

  /** Schritt 2: bestätigte Schlüssel-Zuordnungen übernehmen. */
  async function handleApplyKeys() {
    const assignments = keySelections
      .filter((k) => k.selected && !k.already_has_key && k.key_number > 0)
      .map((k) => ({ object_id: k.object_id, key_number: k.key_number }));
    if (assignments.length === 0) {
      toast.info("Keine gültigen Schlüssel zum Übernehmen ausgewählt.");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/objects/import/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Übernehmen fehlgeschlagen.");
        return;
      }
      setKeyResult(body as KeyImportResult);
      onImported();
    } catch {
      setError("Übernehmen fehlgeschlagen.");
    } finally {
      setApplying(false);
    }
  }

  /** Schritt 2: bestätigte Objekte anlegen. */
  async function handleApplyObjects() {
    const objects = objectSelections
      .filter((o) => o.selected && o.address.trim().length > 0)
      .map((o) => ({
        name: o.name.trim() || o.address.trim(),
        address: o.address.trim(),
        category: o.category,
        is_pedestrian_zone_until_11: o.is_pedestrian_zone_until_11,
        opens_at: o.opens_at || null,
        latitude: o.latitude,
        longitude: o.longitude,
      }));
    if (objects.length === 0) {
      toast.info("Keine Objekte zum Anlegen ausgewählt.");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/objects/import/objects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objects }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Anlegen fehlgeschlagen.");
        return;
      }
      setObjectResult(body as ImportResult);
      onImported();
    } catch {
      setError("Anlegen fehlgeschlagen.");
    } finally {
      setApplying(false);
    }
  }

  /** Schritt 2: bestätigte Items-Gruppen übernehmen. */
  async function handleApplyItems() {
    const groups = itemSelections
      .filter((g) => g.selected)
      .map((g) => ({
        object_id: g.object_id,
        items: g.items
          .filter((i) => i.item_name.trim().length > 0)
          .map((i) => ({
            item_name: i.item_name.trim(),
            quantity: Number.parseInt(i.quantity, 10) || 1,
            note: i.note.trim() || null,
          })),
      }))
      .filter((g) => g.items.length > 0);
    if (groups.length === 0) {
      toast.info("Keine Items zum Übernehmen ausgewählt.");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/objects/import/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Übernehmen fehlgeschlagen.");
        return;
      }
      setItemResult(body as ItemGroupImportResult);
      onImported();
    } catch {
      setError("Übernehmen fehlgeschlagen.");
    } finally {
      setApplying(false);
    }
  }

  const description = (() => {
    if (mode === "keys") {
      return "Fotografiere eine Schlüsselliste mit Objektnamen und -nummern. Die KI ordnet die Nummern den Objekten zu – du kannst die Zuordnung anpassen und bestätigst vor dem Speichern.";
    }
    if (mode === "items") {
      return "Fotografiere eine Packliste, auf der der Objektname (oft mit Adresse) und die Items stehen. Die KI ordnet die Items dem passenden Objekt zu – du bestätigst vor dem Speichern.";
    }
    return "Fotografiere eine gedruckte Adressliste. Die KI erkennt die Objekte – du kannst Name, Adresse und Kategorie anpassen und bestätigst vor dem Anlegen.";
  })();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            Foto-Import (KI)
            {mode && (
              <Badge variant="secondary" className="ml-auto">
                {MODE_OPTIONS.find((o) => o.mode === mode)?.title}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Schritt 0: Modus wählen */}
        {!mode && (
          <div className="space-y-2">
            {MODE_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.mode}
                  type="button"
                  onClick={() => pickMode(option.mode)}
                  className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">
                      {option.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Schritt 1: Bild hochladen / analysieren */}
        {mode &&
          !objectPreview &&
          !keyPreview &&
          !itemPreview &&
          !objectResult &&
          !keyResult &&
          !itemResult && (
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
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors",
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
                    alt="Vorschau des hochgeladenen Fotos"
                    className="max-h-56 w-full bg-muted/30 object-contain"
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

        {/* Schritt 2 (Objekte): Vorauswahl bearbeiten + bestätigen */}
        {mode === "objects" && objectPreview && !objectResult && (
          <ObjectPreviewBody
            selections={objectSelections}
            setSelections={setObjectSelections}
          />
        )}

        {/* Schritt 2 (Schlüssel): Vorauswahl bearbeiten + bestätigen */}
        {mode === "keys" && keyPreview && !keyResult && (
          <KeyPreviewBody
            preview={keyPreview}
            selections={keySelections}
            setSelections={setKeySelections}
          />
        )}

        {/* Schritt 2 (Items): Vorauswahl bestätigen/bearbeiten */}
        {mode === "items" && itemPreview && !itemResult && (
          <ItemPreviewBody
            preview={itemPreview}
            selections={itemSelections}
            setSelections={setItemSelections}
          />
        )}

        {/* Schritt 3: Ergebnisse */}
        {mode === "objects" && objectResult && (
          <ObjectResultBody result={objectResult} />
        )}
        {mode === "keys" && keyResult && <KeyResultBody result={keyResult} />}
        {mode === "items" && itemResult && (
          <ItemResultBody result={itemResult} />
        )}

        {error &&
          !objectResult &&
          !keyResult &&
          !itemResult &&
          (objectPreview || keyPreview || itemPreview) && (
            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

        <DialogFooter>
          {/* Ergebnis -> Fertig */}
          {mode === "objects" && objectResult && (
            <Button onClick={() => handleClose(false)}>Fertig</Button>
          )}
          {mode === "keys" && keyResult && (
            <Button onClick={() => handleClose(false)}>Fertig</Button>
          )}
          {mode === "items" && itemResult && (
            <Button onClick={() => handleClose(false)}>Fertig</Button>
          )}

          {/* Vorauswahl -> Bestätigen + zurück */}
          {mode === "objects" && objectPreview && !objectResult && (
            <>
              <Button
                variant="ghost"
                onClick={backToUpload}
                disabled={applying}
                className="gap-1.5"
              >
                <ArrowLeft />
                Anderes Bild
              </Button>
              <Button
                onClick={() => void handleApplyObjects()}
                disabled={applying}
              >
                {applying ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    Wird angelegt…
                  </>
                ) : (
                  "Übernehmen"
                )}
              </Button>
            </>
          )}
          {mode === "keys" && keyPreview && !keyResult && (
            <>
              <Button
                variant="ghost"
                onClick={backToUpload}
                disabled={applying}
                className="gap-1.5"
              >
                <ArrowLeft />
                Anderes Bild
              </Button>
              <Button
                onClick={() => void handleApplyKeys()}
                disabled={applying}
              >
                {applying ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    Wird übernommen…
                  </>
                ) : (
                  "Übernehmen"
                )}
              </Button>
            </>
          )}
          {mode === "items" && itemPreview && !itemResult && (
            <>
              <Button
                variant="ghost"
                onClick={backToUpload}
                disabled={applying}
                className="gap-1.5"
              >
                <ArrowLeft />
                Anderes Bild
              </Button>
              <Button
                onClick={() => void handleApplyItems()}
                disabled={applying}
              >
                {applying ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    Wird übernommen…
                  </>
                ) : (
                  "Übernehmen"
                )}
              </Button>
            </>
          )}

          {/* Hochladen -> Abbrechen + Analysieren */}
          {mode &&
            !objectPreview &&
            !keyPreview &&
            !itemPreview &&
            !objectResult &&
            !keyResult &&
            !itemResult && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setMode(null)}
                  disabled={busy}
                  className="gap-1.5"
                >
                  <ArrowLeft />
                  Zurück
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleClose(false)}
                  disabled={busy}
                >
                  Abbrechen
                </Button>
                <Button
                  onClick={() => void handleAnalyze()}
                  disabled={!file || busy}
                >
                  {busy ? (
                    <>
                      <LoaderCircle className="animate-spin" />
                      Bild wird analysiert…
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

          {/* Modus-Auswahl -> Abbrechen */}
          {!mode && (
            <Button variant="outline" onClick={() => handleClose(false)}>
              Abbrechen
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Objekt-Vorauswahl (editierbar)                                      */
/* ------------------------------------------------------------------ */

function ObjectPreviewBody({
  selections,
  setSelections,
}: {
  selections: ObjectSelection[];
  setSelections: React.Dispatch<React.SetStateAction<ObjectSelection[]>>;
}) {
  const selectedCount = selections.filter((o) => o.selected).length;

  function update(index: number, patch: Partial<ObjectSelection>) {
    setSelections((prev) =>
      prev.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    );
  }

  return (
    <div className="space-y-4">
      {selections.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Store className="h-4 w-4 text-primary" />
            Erkannte Objekte
            <Badge variant="secondary">{selectedCount}</Badge>
          </p>
          <div className="space-y-3">
            {selections.map((o, i) => (
              <div key={i} className="rounded-md border bg-card p-2.5">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={o.selected}
                    onCheckedChange={(v) => update(i, { selected: v === true })}
                    aria-label={`${o.name}: anlegen`}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {o.name || "(ohne Name)"}
                  </span>
                  {o.is_duplicate && (
                    <Badge variant="secondary">Bereits vorhanden</Badge>
                  )}
                </div>

                <div className="mt-2 space-y-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Name
                    </Label>
                    <Input
                      className="mt-1 h-8"
                      value={o.name}
                      onChange={(e) => update(i, { name: e.target.value })}
                      aria-label={`Name für Objekt ${i + 1}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Adresse
                    </Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input
                        className="h-8 flex-1"
                        value={o.address}
                        onChange={(e) =>
                          update(i, {
                            address: e.target.value,
                            // Adresse geändert: ORS-Koordinaten gelten nicht mehr,
                            // der Server geocodiert beim Anlegen neu.
                            latitude: null,
                            longitude: null,
                            geocoding_status: "not_found",
                          })
                        }
                        aria-label={`Adresse für Objekt ${i + 1}`}
                      />
                      {o.geocoding_status === "ok" ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 gap-1 border-success/40 text-success"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          ORS-Treffer
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="shrink-0">
                          Adresse nicht gefunden
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Kategorie
                      </Label>
                      <Select
                        value={o.category}
                        onValueChange={(v) =>
                          update(i, { category: v as ObjectCategory })
                        }
                      >
                        <SelectTrigger className="mt-1 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="objekt">Objekt</SelectItem>
                          <SelectItem value="treppenhaus">
                            Treppenhaus
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Öffnet ab
                      </Label>
                      <Input
                        type="time"
                        className="mt-1 h-8"
                        value={o.opens_at}
                        onChange={(e) => update(i, { opens_at: e.target.value })}
                        aria-label={`Öffnet ab für Objekt ${i + 1}`}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox
                      checked={o.is_pedestrian_zone_until_11}
                      onCheckedChange={(v) =>
                        update(i, { is_pedestrian_zone_until_11: v === true })
                      }
                      aria-label={`Fußgängerzone für Objekt ${i + 1}`}
                    />
                    Fußgängerzone bis 11 Uhr
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selections.length === 0 && (
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Keine Objekte im Foto erkannt.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Schlüssel-Vorauswahl (editierbar)                                   */
/* ------------------------------------------------------------------ */

function KeyPreviewBody({
  preview,
  selections,
  setSelections,
}: {
  preview: KeyImportPreview;
  selections: KeySelection[];
  setSelections: React.Dispatch<React.SetStateAction<KeySelection[]>>;
}) {
  const selectedCount = selections.filter((k) => k.selected).length;

  function update(index: number, patch: Partial<KeySelection>) {
    setSelections((prev) =>
      prev.map((k, i) => (i === index ? { ...k, ...patch } : k)),
    );
  }

  /** Zuordnung zu einem anderen Objekt ändern. */
  function pickObject(index: number, objectId: string) {
    const obj = preview.objects.find((o) => o.id === objectId);
    if (!obj) return;
    update(index, {
      object_id: obj.id,
      object_name: obj.name,
      address: obj.address,
      already_has_key: obj.key_number != null,
      selected: obj.key_number == null,
    });
  }

  return (
    <div className="space-y-4">
      {selections.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <KeyRound className="h-4 w-4 text-primary" />
            Zuordnungen
            <Badge variant="secondary">{selectedCount}</Badge>
          </p>
          <ul className="space-y-2">
            {selections.map((k, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-md border bg-card p-2.5"
              >
                <Checkbox
                  checked={k.selected}
                  disabled={k.already_has_key}
                  onCheckedChange={(v) => update(i, { selected: v === true })}
                  aria-label={`${k.object_name}: Schlüssel zuordnen`}
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Objekt
                    </Label>
                    <Select
                      value={k.object_id}
                      onValueChange={(v) => pickObject(i, v)}
                    >
                      <SelectTrigger className="mt-1 h-8 w-full">
                        <SelectValue placeholder="Objekt wählen…" />
                      </SelectTrigger>
                      <SelectContent>
                        {preview.objects.map((obj) => (
                          <SelectItem key={obj.id} value={obj.id}>
                            {obj.name}
                            {obj.key_number != null
                              ? ` (Nr. ${obj.key_number})`
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {k.address && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {k.address}
                      </span>
                    )}
                    {k.already_has_key && (
                      <Badge variant="secondary">Schlüssel vorhanden</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Schlüssel-Nr.
                    </span>
                    <Input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      className="h-8 w-20"
                      value={String(k.key_number)}
                      onChange={(e) =>
                        update(i, {
                          key_number: Number.parseInt(e.target.value, 10) || 0,
                        })
                      }
                      aria-label={`Schlüssel-Nummer für ${k.object_name}`}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.unmatched.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            Objekt nicht gefunden ({preview.unmatched.length}) – wird nicht
            übernommen
          </p>
          <ul className="space-y-1">
            {preview.unmatched.map((u, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground"
              >
                <Badge variant="outline">?</Badge>
                <span className="truncate">{u.name ?? "(ohne Name)"}</span>
                <span className="ml-auto tabular-nums">Nr. {u.key_number}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selections.length === 0 && preview.unmatched.length === 0 && (
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Keine Schlüssel im Foto erkannt.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Items-Vorauswahl                                                    */
/* ------------------------------------------------------------------ */

function ItemPreviewBody({
  preview,
  selections,
  setSelections,
}: {
  preview: ItemGroupImportPreview;
  selections: ItemSelection[];
  setSelections: React.Dispatch<React.SetStateAction<ItemSelection[]>>;
}) {
  const selectedCount = selections.filter((g) => g.selected).length;

  function updateGroup(index: number, patch: Partial<ItemSelection>) {
    setSelections((prev) =>
      prev.map((g, i) => (i === index ? { ...g, ...patch } : g)),
    );
  }

  function updateItem(
    groupIndex: number,
    itemIndex: number,
    patch: Partial<ItemDraft>,
  ) {
    setSelections((prev) =>
      prev.map((g, gi) =>
        gi === groupIndex
          ? {
              ...g,
              items: g.items.map((item, ii) =>
                ii === itemIndex ? { ...item, ...patch } : item,
              ),
            }
          : g,
      ),
    );
  }

  function removeItem(groupIndex: number, itemIndex: number) {
    setSelections((prev) =>
      prev.map((g, gi) =>
        gi === groupIndex
          ? { ...g, items: g.items.filter((_, ii) => ii !== itemIndex) }
          : g,
      ),
    );
  }

  function addItem(groupIndex: number) {
    setSelections((prev) =>
      prev.map((g, gi) =>
        gi === groupIndex
          ? {
              ...g,
              items: [
                ...g.items,
                { item_name: "", quantity: "1", note: "" },
              ],
            }
          : g,
      ),
    );
  }

  return (
    <div className="space-y-4">
      {selections.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <ListChecks className="h-4 w-4 text-primary" />
            Zuordnungen
            <Badge variant="secondary">{selectedCount}</Badge>
          </p>
          <div className="space-y-3">
            {selections.map((g, gi) => (
              <div
                key={g.object_id}
                className="rounded-md border bg-card p-2.5"
              >
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={g.selected}
                    onCheckedChange={(v) =>
                      updateGroup(gi, { selected: v === true })
                    }
                    aria-label={`${g.object_name}: Gruppe übernehmen`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {g.object_name}
                    </span>
                    {g.address && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {g.address}
                      </span>
                    )}
                  </span>
                </label>

                {g.items.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {g.items.map((item, ii) => (
                      <li
                        key={ii}
                        className="flex items-center gap-1.5"
                      >
                        <Input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          className="h-8 w-16"
                          value={item.quantity}
                          onChange={(e) =>
                            updateItem(gi, ii, { quantity: e.target.value })
                          }
                          aria-label={`Menge ${item.item_name || "Item " + (ii + 1)}`}
                        />
                        <Input
                          className="h-8 flex-1"
                          value={item.item_name}
                          onChange={(e) =>
                            updateItem(gi, ii, { item_name: e.target.value })
                          }
                          placeholder="Bezeichnung"
                          aria-label={`Bezeichnung Item ${ii + 1}`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={`Item ${ii + 1} entfernen`}
                          onClick={() => removeItem(gi, ii)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 gap-1 text-xs text-muted-foreground"
                  onClick={() => addItem(gi)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Item
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.unmatched.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            Objekt nicht gefunden ({preview.unmatched.length}) – wird nicht
            übernommen
          </p>
          <ul className="space-y-1">
            {preview.unmatched.map((u, i) => (
              <li
                key={i}
                className="rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground"
              >
                <span className="font-medium">
                  {u.name ?? "(ohne Name)"}
                </span>
                {u.address && <span> · {u.address}</span>}
                <span className="ml-2 text-xs">
                  {u.items.length} Item{u.items.length === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selections.length === 0 && preview.unmatched.length === 0 && (
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Keine Items im Foto erkannt.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ergebnis-Zusammenfassungen                                          */
/* ------------------------------------------------------------------ */

function ResultStat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "success" | "neutral" | "destructive";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "destructive"
        ? "text-destructive"
        : "";
  return (
    <div className="rounded-md border bg-card p-3 text-center">
      <p className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function ObjectResultBody({ result }: { result: ImportResult }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <ResultStat
          value={result.created.length}
          label="neu angelegt"
          tone="success"
        />
        <ResultStat
          value={result.duplicates.length}
          label="übersprungen"
          tone="neutral"
        />
        <ResultStat value={result.errors.length} label="Fehler" tone="destructive" />
      </div>

      {result.created.length > 0 && (
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

      {result.duplicates.length > 0 && (
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

      {result.errors.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {result.errors.length} Einträge konnten nicht zugeordnet werden.
        </p>
      )}
    </div>
  );
}

function KeyResultBody({ result }: { result: KeyImportResult }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <ResultStat
          value={result.assigned}
          label="Schlüssel zugeordnet"
          tone="success"
        />
        <ResultStat
          value={result.already_had_key}
          label="hatte schon Schlüssel"
          tone="neutral"
        />
        <ResultStat
          value={result.not_found}
          label="Objekt nicht gefunden"
          tone="destructive"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Objekte, die bereits eine Schlüsselnummer hatten, wurden nicht
        überschrieben. Nicht gefundene Objekte wurden übersprungen.
      </p>
    </div>
  );
}

function ItemResultBody({ result }: { result: ItemGroupImportResult }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <ResultStat
          value={result.assigned}
          label="Objekte befüllt"
          tone="success"
        />
        <ResultStat
          value={result.items_added}
          label="Items hinzugefügt"
          tone="neutral"
        />
        <ResultStat
          value={result.not_found}
          label="Objekt nicht gefunden"
          tone="destructive"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Die Items wurden den erkannten Objekten als Standard-Items
        hinzugefügt und erscheinen in der nächsten Tour.
      </p>
    </div>
  );
}
