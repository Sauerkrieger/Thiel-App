"use client";

import { Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  /** Vollständige Adresse (z. B. „Hauptstraße 12, 97072 Würzburg“). */
  address: string | null;
  /** Koordinaten-Fallback, falls keine Adresse vorhanden ist. */
  latitude: number | null;
  longitude: number | null;
  /** Zielname für den Accessibility-Label. */
  label: string;
  /** Öffnet nur die Google-Maps-Suche, ohne eine Navigationsroute zu starten. */
  openOnly?: boolean;
};

/**
 * Startet die Navigation vom aktuellen Standort zum Ziel in der
 * System-Navigations-App:
 *   - iOS (iPhone/iPad): Apple Maps
 *   - Android / sonstige: Google Maps
 *
 * Bevorzugt wird die gespeicherte Adresse übergeben, damit Google/Apple
 * Maps selbst geokodieren – das Ziel entspricht dann dem, was in der
 * Objektliste steht (die gespeicherten Koordinaten stammen von
 * OSM/Photon/ORS und weichen teils vom Google-Treffer ab). Nur wenn keine
 * Adresse vorliegt, werden die Koordinaten direkt genutzt.
 */
export function NavigateButton({ address, latitude, longitude, label, openOnly = false }: Props) {
  if (!address && (latitude == null || longitude == null)) return null;

  function handleNavigate(e: React.MouseEvent) {
    e.stopPropagation();
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const destination = address
      ? encodeURIComponent(address)
      : `${latitude},${longitude}`;
    const url = openOnly
      ? `https://www.google.com/maps/search/?api=1&query=${destination}`
      : isIOS
        ? `https://maps.apple.com/?daddr=${destination}`
        : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={handleNavigate}
      aria-label={openOnly ? `Google Maps für ${label} öffnen` : `Navigation zu ${label} starten`}
      title={openOnly ? "In Google Maps öffnen" : "Navigation starten"}
      className="h-8 w-8 shrink-0"
    >
      <Navigation className="h-4 w-4" />
    </Button>
  );
}
