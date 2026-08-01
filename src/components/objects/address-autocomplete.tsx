"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { CheckCircle2, Loader2, MapPin, SearchX } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AddressSuggestion } from "@/app/api/geocoding/autocomplete/route";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;

type Props = {
  id?: string;
  /** Aktueller Text der Adresse (kontrollierter Wert). */
  value: string;
  /** Wird bei manueller Eingabe aufgerufen. */
  onChange: (value: string) => void;
  /** Wird aufgerufen, sobald eine Adresse aus den Vorschlägen gewählt wurde. */
  onSelect: (suggestion: AddressSuggestion) => void;
  /**
   * Wird aufgerufen, wenn eine manuell getippte Adresse (ohne Vorschlag-Auswahl)
   * beim Verlassen des Feldes per ORS verifiziert wurde. `null` = kein Treffer.
   */
  onVerified?: (suggestion: AddressSuggestion | null) => void;
  /** true, wenn die aktuelle Adresse als verifiziert angezeigt werden soll. */
  verified?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
};

export function AddressAutocomplete({
  id,
  value,
  onChange,
  onSelect,
  onVerified,
  verified = false,
  placeholder,
  autoFocus,
  disabled,
}: Props) {
  const generatedId = useId();
  const inputId = id ?? `address-autocomplete-${generatedId}`;

  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const wrapperRef = useRef<HTMLDivElement>(null);
  /** true, solange das Eingabefeld fokussiert ist. */
  const focusedRef = useRef(false);
  /** true, während der Nutzer manuell tippt (nicht bei programmatischen Änderungen). */
  const typingRef = useRef(false);
  /** Laufnummer, um veraltete Verify-Antworten (nach erneutem Fokus/Tippen) zu verwerfen. */
  const verifySeqRef = useRef(0);

  const trimmed = value.trim();

  /* ------------------------------------------------------------------ */
  /* Debounce + Suche                                                   */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    // Nur bei aktiver Nutzereingabe suchen – nicht bei programmatischen
    // Wertänderungen (Auswahl eines Vorschlags, Befüllen des Formulars).
    if (!focusedRef.current || !typingRef.current) return;

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setLoading(false);
      setError(false);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    setLoading(true);
    setOpen(true);
    setActiveIndex(-1);

    // Ablauf-Flag statt AbortController: Ein controller.abort() würde in
    // Next.js Dev (Turbopack) als Runtime-Fehler "signal is aborted
    // without reason" gemeldet. Das Flag ignoriert stattdessen einfach
    // die Ergebnisse veralteter Anfragen – es gibt nichts zu abbrechen.
    let cancelled = false;

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/geocoding/autocomplete?q=${encodeURIComponent(trimmed)}`,
        );
        if (cancelled) return;
        if (!res.ok) {
          setError(true);
          setSuggestions([]);
          return;
        }
        const body: { suggestions?: AddressSuggestion[] } = await res.json();
        if (cancelled) return;
        setSuggestions(body.suggestions ?? []);
        setError(false);
      } catch {
        if (cancelled) return;
        setError(true);
        setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      cancelled = true;
    };
  }, [trimmed]);

  /* ------------------------------------------------------------------ */
  /* Klick außerhalb schließt die Liste                                  */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  /* ------------------------------------------------------------------ */
  /* Auswahl & Tastatur                                                  */
  /* ------------------------------------------------------------------ */

  const handleSelect = useCallback(
    (suggestion: AddressSuggestion) => {
      // Jede Nutzeraktion invalidiert eine laufende Blur-Verify-Anfrage,
      // damit eine veraltete Antwort keine neuere Auswahl überschreibt.
      verifySeqRef.current++;
      // Verhindert, dass die durch die Wertänderung ausgelöste
      // Effekt-Neuausführung erneut sucht und die Liste öffnet.
      typingRef.current = false;
      setSuggestions([]);
      setLoading(false);
      setOpen(false);
      setActiveIndex(-1);
      onSelect(suggestion);
    },
    [onSelect],
  );

  /**
   * Beim Verlassen des Feldes: manuell getippte Adresse (kein Vorschlag
   * gewählt) automatisch per ORS verifizieren und das Ergebnis melden.
   */
  const verifyTypedAddress = useCallback(
    async (raw: string) => {
      if (!onVerified || raw.trim().length < MIN_QUERY_LENGTH) return;
      const seq = ++verifySeqRef.current;
      try {
        const res = await fetch("/api/geocoding/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: raw }),
        });
        if (seq !== verifySeqRef.current) return;
        const body = await res.json().catch(() => null);
        if (seq !== verifySeqRef.current) return;
        if (res.ok && body && body.verified && body.suggestion) {
          onVerified(body.suggestion as AddressSuggestion);
        } else {
          onVerified(null);
        }
      } catch {
        if (seq === verifySeqRef.current) onVerified(null);
      }
    },
    [onVerified],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (e.key === "Escape") setOpen(false);
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex(
          (i) => (i - 1 + suggestions.length) % suggestions.length,
        );
        break;
      case "Enter":
        // Vorschlag nur übernehmen, wenn der Nutzer aktiv mit den
        // Pfeiltasten einen Eintrag markiert hat. Ohne Markierung wird
        // Enter NICHT geschluckt – dann sendet das Formular normal ab.
        // So bleiben z. B. eingetippte Hausnummern Teil der Adresse.
        if (activeIndex >= 0 && activeIndex < suggestions.length) {
          e.preventDefault();
          handleSelect(suggestions[activeIndex]);
        } else {
          setOpen(false);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
    }
  }

  const showDropdown = open && trimmed.length >= MIN_QUERY_LENGTH;

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Input
          id={inputId}
          value={value}
          onChange={(e) => {
            // Weiteres Tippen invalidiert eine laufende Blur-Verify-Anfrage.
            verifySeqRef.current++;
            typingRef.current = true;
            onChange(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            focusedRef.current = true;
            // Nur öffnen, wenn bereits Treffer geladen sind – sonst würde
            // bei vorbefüllten Feldern fälschlich "Keine Treffer" erscheinen.
            if (suggestions.length > 0) setOpen(true);
          }}
          onBlur={() => {
            focusedRef.current = false;
            setOpen(false);
            setActiveIndex(-1);
            // Nur verifizieren, wenn der Nutzer wirklich manuell getippt hat
            // (eine Vorschlag-Auswahl setzt typingRef vorher auf false).
            if (typingRef.current) {
              const typed = value.trim();
              typingRef.current = false;
              void verifyTypedAddress(typed);
            }
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls={showDropdown ? `${inputId}-listbox` : undefined}
          aria-activedescendant={
            activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined
          }
          className={cn(
            "pr-9",
            verified && "border-success/60 focus-visible:ring-success/40",
          )}
        />
        {/* Status-Icon rechts im Feld */}
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : verified ? (
            <CheckCircle2
              className="h-4 w-4 text-success"
              aria-label="Adresse verifiziert"
            />
          ) : null}
        </span>
      </div>

      {/* Verifiziert-Hinweis */}
      {verified && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Adresse verifiziert
        </p>
      )}

      {/* Vorschlagsliste */}
      {showDropdown && (
        <ul
          id={`${inputId}-listbox`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {loading && suggestions.length === 0 && (
            <li className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Suche Adressen…
            </li>
          )}

          {!loading && error && (
            <li className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
              <SearchX className="h-3.5 w-3.5 shrink-0" />
              Adresssuche gerade nicht verfügbar.
            </li>
          )}

          {!loading && !error && suggestions.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">
              Keine Treffer für „{trimmed}“.
            </li>
          )}

          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.label}-${index}`}>
              <button
                type="button"
                id={`${inputId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(e) => {
                  // Verhindert, dass das Input durch Blur vor dem Klick zuklappt.
                  e.preventDefault();
                  handleSelect(suggestion);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-sm px-2.5 py-2 text-left text-sm",
                  index === activeIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground",
                )}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {suggestion.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {suggestion.name}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
