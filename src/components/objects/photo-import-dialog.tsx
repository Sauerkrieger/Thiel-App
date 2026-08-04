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
  X,
} from "lucide-react";
import { toast } from "sonner";
import { hasHouseNumber } from "@/lib/utils";
import { cleanAddressLabel } from "@/lib/address";
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
  ItemGroupImportPreview,
  ItemGroupImportResult,
  KeyImportPreview,
  KeyImportResult,
} from "@/types/api";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

type Mode = "keys" | "items";

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

/** Bearbeitbares Item innerhalb einer Items-Gruppe. */
type ItemDraft = {
  item_name: string;
  quantity: string;
  note: string;
  /** true = Standard-Item (bei jeder Belieferung fest vorgesehen). */
  is_always_required: boolean;
};

/** Aus der Items-Vorauswahl bestätigbare Gruppe. */
type ItemSelection = {
  object_id: string;
  object_name: string;
  address: string | null;
  items: ItemDraft[];
  selected: boolean;
  /** true: das erkannte Objekt existiert nicht und wird neu angelegt. */
  is_new_object?: boolean;
  /** Name des neuen Objekts (nur bei is_new_object). */
  new_name?: string;
  /** Exakte Adresse des neuen Objekts (nur bei is_new_object). */
  new_address?: string;
  /** Koordinaten aus dem Geocoding (nur bei is_new_object). */
  latitude?: number | null;
  longitude?: number | null;
  /** Ob eine exakte Adresse mit Hausnummer vorliegt (nur bei is_new_object). */
  geocoding_status?: "ok" | "not_found";
  /** Kunde (Admin-Info, wird am Objekt gespeichert). */
  customer: string;
  customer_number: string;
  cleaning_interval: string;
  /** Kategorie des neuen Objekts (nur bei is_new_object). */
  category?: ObjectCategory;
};

const MODE_OPTIONS: {
  mode: Mode;
  icon: typeof ScanLine;
  title: string;
  description: string;
}[] = [
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
    description: "Packliste mit Objektnamen – Items zuordnen, unbekannte Objekte automatisch anlegen.",
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
    setKeyPreview(null);
    setKeyResult(null);
    setItemPreview(null);
    setItemResult(null);
    setError(null);
  }

  function backToUpload() {
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
        // Erkannte Zuordnungen + „Objekt nicht gefunden“-Einträge. Neue
        // Objekte werden beim Schlüssel-Import nicht angelegt – Schlüssel
        // ohne passendes Objekt können nur einem bestehenden Objekt
        // zugeordnet werden (oder werden nicht übernommen).
        setKeySelections([
          ...previewData.matches.map((m) => ({
            object_id: m.object_id,
            object_name: m.object_name,
            address: m.address,
            key_number: m.key_number,
            already_has_key: m.already_has_key,
            selected: !m.already_has_key,
          })),
          ...previewData.unmatched.map((u) => ({
            object_id: "",
            object_name: u.name ?? "(ohne Name)",
            address: "",
            key_number: u.key_number,
            already_has_key: false,
            selected: false,
          })),
        ]);
      } else {
        // Items: Vorschau + automatisches Anlegen unbekannter Objekte.
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
        // Treffer + nicht gefundene Objekte: Letztere werden automatisch als
        // neue Objekte angelegt (Adresse wurde per Geocoding aufgelöst).
        setItemSelections([
          ...previewData.matches.map((m) => ({
            object_id: m.object_id,
            object_name: m.object_name,
            address: m.address,
            customer: m.customer ?? "",
            customer_number: m.customer_number ?? "",
            cleaning_interval: m.cleaning_interval ?? "",
            items: m.items.map((i) => ({
              item_name: i.item_name,
              quantity: String(i.quantity),
              note: i.note ?? "",
              is_always_required: i.is_always_required,
            })),
            selected: true,
          })),
          ...previewData.unmatched.map((u) => ({
            object_id: "",
            object_name: u.name ?? "(ohne Name)",
            address: u.address,
            customer: u.customer ?? "",
            customer_number: u.customer_number ?? "",
            cleaning_interval: u.cleaning_interval ?? "",
            items: u.items.map((i) => ({
              item_name: i.item_name,
              quantity: String(i.quantity),
              note: i.note ?? "",
              is_always_required: i.is_always_required,
            })),
            selected: true,
            is_new_object: true,
            new_name: u.name ?? "",
            new_address: u.address ?? "",
            latitude: u.latitude,
            longitude: u.longitude,
            geocoding_status: u.geocoding_status,
            category: u.category,
          })),
        ]);
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
      .filter((k) => k.object_id)
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

  /** Schritt 2: bestätigte Items-Gruppen übernehmen. */
  async function handleApplyItems() {
    const groups = itemSelections
      .filter((g) => g.selected && !g.is_new_object)
      .map((g) => ({
        object_id: g.object_id,
        customer: g.customer.trim() || null,
        customer_number: g.customer_number.trim() || null,
        cleaning_interval: g.cleaning_interval.trim() || null,
        items: g.items
          .filter((i) => i.item_name.trim().length > 0)
          .map((i) => ({
            item_name: i.item_name.trim(),
            quantity: Number.parseInt(i.quantity, 10) || 1,
            note: i.note.trim() || null,
            is_always_required: i.is_always_required,
          })),
      }))
      .filter((g) => g.items.length > 0);

    // Nicht gefundene Objekte werden neu angelegt – eine exakte Adresse
    // (mit Hausnummer) ist dafür Pflicht.
    const newObjects = itemSelections
      .filter((g) => g.selected && g.is_new_object)
      .map((g) => ({
        name: (g.new_name ?? "").trim(),
        address: (g.new_address ?? "").trim(),
        latitude: g.latitude ?? null,
        longitude: g.longitude ?? null,
        category: g.category ?? "objekt",
        customer: g.customer.trim() || null,
        customer_number: g.customer_number.trim() || null,
        cleaning_interval: g.cleaning_interval.trim() || null,
        items: g.items
          .filter((i) => i.item_name.trim().length > 0)
          .map((i) => ({
            item_name: i.item_name.trim(),
            quantity: Number.parseInt(i.quantity, 10) || 1,
            note: i.note.trim() || null,
            is_always_required: i.is_always_required,
          })),
      }))
      .filter(
        (o) =>
          o.name.length > 0 && hasHouseNumber(o.address) && o.items.length > 0,
      );
    const skippedNew =
      itemSelections.filter((g) => g.selected && g.is_new_object).length -
      newObjects.length;

    if (groups.length === 0 && newObjects.length === 0) {
      if (skippedNew > 0) {
        toast.warning(
          `${skippedNew} neue${skippedNew === 1 ? "s" : ""} Objekt${skippedNew === 1 ? "" : "e"} übersprungen – exakte Adresse (mit Hausnummer) fehlt.`,
        );
      } else {
        toast.info("Keine Items zum Übernehmen ausgewählt.");
      }
      return;
    }
    if (skippedNew > 0) {
      toast.warning(
        `${skippedNew} neue${skippedNew === 1 ? "s" : ""} Objekt${skippedNew === 1 ? "" : "e"} übersprungen – exakte Adresse (mit Hausnummer) fehlt.`,
      );
    }

    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/objects/import/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups, new_objects: newObjects }),
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
      return "Fotografiere eine Schlüsselliste mit Objektnamen und -nummern. Die KI ordnet die Nummern bestehenden Objekten zu – du kannst die Zuordnung in der Vorschau anpassen. Schlüssel ohne passendes Objekt werden nicht übernommen. Du bestätigst vor dem Speichern.";
    }
    if (mode === "items") {
      return "Fotografiere eine Packliste mit Objektname (oft mit Adresse oder Ort), Kunde/Kundennummer/Reinigungsturnus und Items. Die KI ordnet die Items dem passenden Objekt zu; unbekannte Objekte werden automatisch mit exakter Adresse angelegt. Du bestätigst vor dem Speichern.";
    }
    return "Fotografiere eine Liste – die KI erkennt die Einträge, du bestätigst vor dem Speichern.";
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
        {mode && !keyPreview && !itemPreview && !keyResult && !itemResult && (
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
        {mode === "keys" && keyResult && <KeyResultBody result={keyResult} />}
        {mode === "items" && itemResult && (
          <ItemResultBody result={itemResult} />
        )}

        {error && !keyResult && !itemResult && (keyPreview || itemPreview) && (
            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

        <DialogFooter>
          {/* Ergebnis -> Fertig */}
          {mode === "keys" && keyResult && (
            <Button onClick={() => handleClose(false)}>Fertig</Button>
          )}
          {mode === "items" && itemResult && (
            <Button onClick={() => handleClose(false)}>Fertig</Button>
          )}

          {/* Vorauswahl -> Bestätigen + zurück */}
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
          {mode && !keyPreview && !itemPreview && !keyResult && !itemResult && (
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
                  // Ohne zugewiesenes Objekt (nicht gefundener Schlüssel)
                  // kann nichts übernommen werden.
                  disabled={k.already_has_key || !k.object_id}
                  onCheckedChange={(v) => update(i, { selected: v === true })}
                  aria-label={`${k.object_name}: Schlüssel zuordnen`}
                />
                <div className="min-w-0 flex-1 space-y-1.5">
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

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {k.address && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {cleanAddressLabel(k.address)}
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

      {selections.length === 0 && (
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
                {
                  item_name: "",
                  quantity: "1",
                  note: "",
                  is_always_required: false,
                },
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
                key={gi}
                className={[
                  "rounded-md border bg-card p-2.5",
                  g.is_new_object ? "border-dashed" : "",
                ].join(" ")}
              >
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={g.selected}
                    onCheckedChange={(v) =>
                      updateGroup(gi, { selected: v === true })
                    }
                    aria-label={`${g.object_name}: Gruppe übernehmen`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {g.object_name}
                    </span>
                    {!g.is_new_object && g.address && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {cleanAddressLabel(g.address)}
                      </span>
                    )}
                  </span>
                  {g.is_new_object && (
                    <Badge variant="secondary">Neu anlegen</Badge>
                  )}
                  {g.is_new_object && g.category === "treppenhaus" && (
                    <Badge variant="outline">Treppenhaus</Badge>
                  )}
                </label>

                {/* Admin-Info: Kunde / Kundennummer / Reinigungsturnus */}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">
                      Kunde (nur Admin)
                    </Label>
                    <Input
                      className="mt-1 h-8"
                      value={g.customer}
                      onChange={(e) =>
                        updateGroup(gi, { customer: e.target.value })
                      }
                      placeholder="z. B. Firma Meyer GmbH"
                      aria-label={`Kunde für ${g.object_name}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Kundennummer
                    </Label>
                    <Input
                      className="mt-1 h-8"
                      value={g.customer_number}
                      onChange={(e) =>
                        updateGroup(gi, { customer_number: e.target.value })
                      }
                      placeholder="z. B. 4711"
                      aria-label={`Kundennummer für ${g.object_name}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Reinigungsturnus
                    </Label>
                    <Input
                      className="mt-1 h-8"
                      value={g.cleaning_interval}
                      onChange={(e) =>
                        updateGroup(gi, { cleaning_interval: e.target.value })
                      }
                      placeholder="z. B. wöchentlich"
                      aria-label={`Reinigungsturnus für ${g.object_name}`}
                    />
                  </div>
                </div>

                {g.is_new_object && (
                  <div className="mt-2 space-y-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Name (neues Objekt)
                      </Label>
                      <Input
                        className="mt-1 h-8"
                        value={g.new_name ?? ""}
                        onChange={(e) =>
                          updateGroup(gi, {
                            new_name: e.target.value,
                            object_name: e.target.value,
                          })
                        }
                        placeholder="Name des Objekts"
                        aria-label={`Name des neuen Objekts ${gi + 1}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Adresse (neues Objekt)
                      </Label>
                      <div className="mt-1 flex items-center gap-2">
                        <Input
                          className="h-8 flex-1"
                          value={g.new_address ?? ""}
                          onChange={(e) =>
                            updateGroup(gi, {
                              new_address: e.target.value,
                              // Adresse geändert: Koordinaten gelten nicht
                              // mehr, der Server geocodiert beim Anlegen neu.
                              latitude: null,
                              longitude: null,
                              geocoding_status: hasHouseNumber(
                                e.target.value,
                              )
                                ? "ok"
                                : "not_found",
                            })
                          }
                          placeholder="Straße + Hausnummer (Pflicht)"
                          aria-label={`Adresse des neuen Objekts ${gi + 1}`}
                        />
                        {g.geocoding_status === "ok" ? (
                          <Badge
                            variant="outline"
                            className="shrink-0 gap-1 border-success/40 text-success"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Adresse gefunden
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="shrink-0">
                            Adresse fehlt
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {g.items.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {g.items.map((item, ii) => (
                      <li
                        key={ii}
                        className="rounded-md border bg-muted/20 p-1.5"
                      >
                        <div className="flex items-center gap-1.5">
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
                        </div>
                        <Input
                          className="mt-1.5 h-8"
                          value={item.note}
                          onChange={(e) =>
                            updateItem(gi, ii, { note: e.target.value })
                          }
                          placeholder="Bemerkung (optional, z. B. rot, gelb - kein blau)"
                          aria-label={`Bemerkung Item ${ii + 1}`}
                        />
                        <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 pl-0.5">
                          <Checkbox
                            checked={item.is_always_required}
                            onCheckedChange={(v) =>
                              updateItem(gi, ii, {
                                is_always_required: v === true,
                              })
                            }
                            aria-label={`${item.item_name || `Item ${ii + 1}`}: als Standard-Item markieren`}
                          />
                          <span
                            className={
                              item.is_always_required
                                ? "text-xs font-medium text-success"
                                : "text-xs text-muted-foreground"
                            }
                          >
                            {item.is_always_required
                              ? "Standard-Item (immer mitnehmen)"
                              : "Als Standard-Item markieren"}
                          </span>
                        </label>
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
          label="nicht zugeordnet"
          tone="destructive"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Objekte, die bereits eine Schlüsselnummer hatten, wurden nicht
        überschrieben. Schlüssel ohne passendes Objekt werden nicht übernommen.
      </p>
    </div>
  );
}

function ItemResultBody({ result }: { result: ItemGroupImportResult }) {
  const skipped = result.not_found + result.new_objects_skipped;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <ResultStat
          value={result.assigned}
          label="Objekte befüllt"
          tone="success"
        />
        <ResultStat
          value={result.new_objects_created}
          label="Objekte angelegt"
          tone="success"
        />
        <ResultStat
          value={result.items_added}
          label="Items hinzugefügt"
          tone="neutral"
        />
        <ResultStat value={skipped} label="übersprungen" tone="destructive" />
      </div>
      <p className="text-xs text-muted-foreground">
        Nicht gefundene Objekte wurden automatisch mit exakter Adresse
        angelegt. Als „Standard“ markierte Items sind bei jeder Belieferung
        fest vorgesehen – alle übernommenen Items erscheinen in der nächsten
        Tour.
      </p>
    </div>
  );
}
