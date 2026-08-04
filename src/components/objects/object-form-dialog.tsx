"use client";

import { useEffect, useRef, useState } from "react";
import {
  ImagePlus,
  LoaderCircle,
  Plus,
  ScanLine,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressAutocomplete } from "./address-autocomplete";
import type { AddressSuggestion } from "@/app/api/geocoding/autocomplete/route";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { itemPhotoUrl } from "@/lib/storage";
import type { ObjectCategory } from "@/types/database";
import type { ObjectWithItems } from "@/types/api";

type Props = {
  open: boolean;
  object: ObjectWithItems | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

type ItemDraft = {
  item_name: string;
  /** Als String gehalten, damit das Eingabefeld auch leer sein darf. */
  quantity: string;
  note: string;
  photo_path: string | null;
  is_always_required: boolean;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function ObjectFormDialog({ open, object, onOpenChange, onSaved }: Props) {
  const isEdit = object !== null;

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [category, setCategory] = useState<ObjectCategory>("objekt");
  const [keyNumber, setKeyNumber] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [customer, setCustomer] = useState("");
  const [customerNumber, setCustomerNumber] = useState("");
  const [cleaningInterval, setCleaningInterval] = useState("");
  const [remark, setRemark] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const ocrInputRef = useRef<HTMLInputElement>(null);
  const photoInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  useEffect(() => {
    if (!open) return;
    setName(object?.name ?? "");
    setAddress(object?.address ?? "");
    setLatitude(object?.latitude ?? null);
    setLongitude(object?.longitude ?? null);
    setCategory(object?.category ?? "objekt");
    setKeyNumber(object?.key_number != null ? String(object.key_number) : "");
    setOpensAt(object?.opens_at ?? "");
    setCustomer(object?.customer ?? "");
    setCustomerNumber(object?.customer_number ?? "");
    setCleaningInterval(object?.cleaning_interval ?? "");
    setRemark(object?.remark ?? "");
    setItems(
      (object?.object_items ?? []).map((item) => ({
        item_name: item.item_name,
        quantity: String(item.quantity ?? 1),
        note: item.note ?? "",
        photo_path: item.photo_path ?? null,
        is_always_required: item.is_always_required,
      })),
    );
    setFormError(null);
  }, [open, object]);

  /** Manuelle Eingabe: Verifizierung (und Koordinaten) zurücksetzen. */
  function handleAddressChange(value: string) {
    setAddress(value);
    setLatitude(null);
    setLongitude(null);
  }

  /** Auswahl aus den Autocomplete-Vorschlägen: Adresse + Koordinaten übernehmen. */
  function handleAddressSelect(suggestion: AddressSuggestion) {
    setAddress(suggestion.label);
    setLatitude(suggestion.latitude);
    setLongitude(suggestion.longitude);
  }

  /**
   * Manuell getippte Adresse (ohne Vorschlag) wurde beim Blur per ORS
   * verifiziert: normalisiertes ORS-Label + Koordinaten übernehmen.
   */
  function handleAddressVerified(suggestion: AddressSuggestion | null) {
    if (!suggestion) return;
    setAddress(suggestion.label);
    setLatitude(suggestion.latitude);
    setLongitude(suggestion.longitude);
  }

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  function addItemRow() {
    setItems((prev) => [
      ...prev,
      { item_name: "", quantity: "1", note: "", photo_path: null, is_always_required: false },
    ]);
  }

  function removeItemRow(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  /** Foto eines Items hochladen (öffentlicher Storage-Bucket). */
  async function handleItemPhoto(index: number, file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Bitte ein Bild (JPG/PNG/WEBP/HEIC) auswählen.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("Das Bild ist größer als 10 MB.");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/items/photo", {
        method: "POST",
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Foto konnte nicht hochgeladen werden.");
        return;
      }
      updateItem(index, { photo_path: body.photo_path });
      toast.success("Foto hochgeladen.");
    } catch {
      toast.error("Foto konnte nicht hochgeladen werden.");
    }
  }

  /** Packlisten-Foto per KI in strukturierte Items umwandeln. */
  async function handleOcrImport(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Bitte ein Bild auswählen.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("Das Bild ist größer als 10 MB.");
      return;
    }
    setOcrBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/items/ocr", {
        method: "POST",
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "KI-Import fehlgeschlagen.");
        return;
      }
      const extracted = Array.isArray(body.items) ? body.items : [];
      if (extracted.length === 0) {
        toast.info("Keine Items im Foto erkannt.");
        return;
      }
      setItems(
        extracted.map(
          (item: { item_name?: unknown; quantity?: unknown; note?: unknown }) => ({
            item_name:
              typeof item.item_name === "string" ? item.item_name : "",
            quantity:
              typeof item.quantity === "number" && item.quantity > 0
                ? String(item.quantity)
                : "1",
            note: typeof item.note === "string" ? item.note : "",
            photo_path: null,
            is_always_required: false,
          }),
        ),
      );
      toast.success(
        `${extracted.length} Item${extracted.length === 1 ? "" : "s"} aus dem Foto übernommen – bitte prüfen.`,
      );
    } catch {
      toast.error("KI-Import fehlgeschlagen.");
    } finally {
      setOcrBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!name.trim() || !address.trim()) {
      setFormError("Name und Adresse sind Pflichtfelder.");
      return;
    }

    const keyParsed = Number(keyNumber.trim());
    const payloadItems = items
      .filter((item) => item.item_name.trim().length > 0)
      .map((item) => ({
        item_name: item.item_name.trim(),
        quantity: Number.parseInt(item.quantity, 10) || 1,
        note: item.note.trim() || null,
        photo_path: item.photo_path,
        is_always_required: item.is_always_required,
      }));

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        address: address.trim(),
        latitude,
        longitude,
        category,
        is_pedestrian_zone_until_11: undefined, // wird serverseitig erkannt
        key_number:
          keyNumber.trim() !== "" && Number.isInteger(keyParsed) && keyParsed > 0
            ? keyParsed
            : null,
        opens_at: opensAt || null,
        customer: customer.trim() || null,
        customer_number: customerNumber.trim() || null,
        cleaning_interval: cleaningInterval.trim() || null,
        remark: remark.trim() || null,
        items: payloadItems,
      };

      const res = await fetch(
        isEdit ? `/api/objects/${object!.id}` : "/api/objects",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFormError(body.error ?? "Speichern fehlgeschlagen.");
        return;
      }

      toast.success(isEdit ? "Objekt aktualisiert." : "Objekt angelegt.");
      onSaved();
      onOpenChange(false);
    } catch {
      setFormError("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Objekt bearbeiten" : "Neues Objekt"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Passe die Stammdaten und Items des Objekts an."
              : "Lege ein neues Lieferobjekt oder Treppenhaus samt Items an."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="obj-name">Name *</Label>
            <Input
              id="obj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Büro Meyer oder Treppenhaus Nord"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="obj-address">Adresse *</Label>
            <AddressAutocomplete
              id="obj-address"
              value={address}
              onChange={handleAddressChange}
              onSelect={handleAddressSelect}
              onVerified={handleAddressVerified}
              verified={latitude !== null && longitude !== null}
              placeholder="z. B. Hauptstraße 12, 12345 Musterstadt"
            />
          </div>

          <div className="space-y-2">
            <Label>Kategorie</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as ObjectCategory)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="objekt">Objekt</SelectItem>
                <SelectItem value="treppenhaus">Treppenhaus</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="obj-key-number">Schlüssel-Nummer (optional)</Label>
              <Input
                id="obj-key-number"
                type="number"
                min={1}
                inputMode="numeric"
                value={keyNumber}
                onChange={(e) => setKeyNumber(e.target.value)}
                placeholder="z. B. 5"
              />
              <p className="text-xs text-muted-foreground">
                Wird in der Schlüssel-Packliste vor Abfahrt angezeigt.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="obj-opens-at">Öffnet ab (Uhrzeit)</Label>
              <Input
                id="obj-opens-at"
                type="time"
                value={opensAt}
                onChange={(e) => setOpensAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Objekt darf erst ab dieser Uhrzeit angefahren werden.
              </p>
            </div>
          </div>

          {/* Bemerkung (für alle sichtbar, nur Admins bearbeiten) */}
          <div className="space-y-2">
            <Label htmlFor="obj-remark">Bemerkung</Label>
            <textarea
              id="obj-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="z. B. Zugang über den Hof, Klingel 2. OG"
              rows={2}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {/* Admin-Info (nur für Admins sichtbar) */}
          <div className="space-y-2">
            <Label>Admin-Info</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="obj-customer">Kunde</Label>
                <Input
                  id="obj-customer"
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  placeholder="z. B. Firma Meyer GmbH"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="obj-customer-number">Kundennummer</Label>
                <Input
                  id="obj-customer-number"
                  value={customerNumber}
                  onChange={(e) => setCustomerNumber(e.target.value)}
                  placeholder="z. B. 4711"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="obj-cleaning-interval">Reinigungsturnus</Label>
                <Input
                  id="obj-cleaning-interval"
                  value={cleaningInterval}
                  onChange={(e) => setCleaningInterval(e.target.value)}
                  placeholder="z. B. wöchentlich"
                />
              </div>
            </div>
          </div>

          {/* Strukturierte Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Items</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => ocrInputRef.current?.click()}
                disabled={ocrBusy}
                className="gap-1.5"
              >
                {ocrBusy ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <ScanLine className="h-4 w-4" />
                )}
                Liste aus Foto generieren
              </Button>
              <input
                ref={ocrInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  void handleOcrImport(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Menge, Bezeichnung, optionale Bemerkung und optionales Foto je
              Zeile – z. B. 60x Micromops (rot, gelb - kein blau).
            </p>
            <div className="space-y-2">
              {items.map((item, index) => (
                <div
                  key={index}
                  className="rounded-md border bg-muted/30 p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={item.is_always_required}
                        onCheckedChange={(v) =>
                          updateItem(index, {
                            is_always_required: v === true,
                          })
                        }
                        aria-label={`Item ${index + 1} als Standard markieren`}
                      />
                      Standard
                    </label>
                    <div className="flex-1" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      aria-label={`Zeile ${index + 1} löschen`}
                      onClick={() => removeItemRow(index)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-[5.5rem_1fr] gap-2">
                    <Input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, { quantity: e.target.value })}
                      placeholder="Menge"
                      aria-label={`Menge für Zeile ${index + 1}`}
                    />
                    <Input
                      value={item.item_name}
                      onChange={(e) => updateItem(index, { item_name: e.target.value })}
                      placeholder="Bezeichnung (z. B. Micromops)"
                      aria-label={`Bezeichnung für Zeile ${index + 1}`}
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      className="flex-1"
                      value={item.note}
                      onChange={(e) => updateItem(index, { note: e.target.value })}
                      placeholder="Bemerkung (optional, z. B. rot, gelb - kein blau)"
                      aria-label={`Bemerkung für Zeile ${index + 1}`}
                    />
                    <input
                      ref={(el) => {
                        if (el) photoInputRefs.current.set(index, el);
                        else photoInputRefs.current.delete(index);
                      }}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        void handleItemPhoto(index, e.target.files?.[0] ?? null);
                        e.target.value = "";
                      }}
                      aria-label={`Foto für Zeile ${index + 1}`}
                    />
                    {item.photo_path ? (
                      <span className="relative shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={itemPhotoUrl(item.photo_path) ?? ""}
                          alt="Item-Foto"
                          className="h-9 w-9 rounded-md border object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => updateItem(index, { photo_path: null })}
                          aria-label="Foto entfernen"
                          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        aria-label={`Foto für Zeile ${index + 1} hochladen`}
                        onClick={() => photoInputRefs.current.get(index)?.click()}
                      >
                        <ImagePlus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addItemRow}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Item hinzufügen
              </Button>
            </div>
          </div>

          {formError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {formError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? "Wird gespeichert…"
                : isEdit
                  ? "Änderungen speichern"
                  : "Objekt anlegen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
