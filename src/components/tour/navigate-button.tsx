"use client";

import { Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  latitude: number | null;
  longitude: number | null;
  /** Zielname für den Accessibility-Label. */
  label: string;
};

/**
 * Startet die Navigation vom aktuellen Standort zum Ziel in der
 * System-Navigations-App:
 *   - iOS (iPhone/iPad): Apple Maps
 *   - Android / sonstige: Google Maps
 */
export function NavigateButton({ latitude, longitude, label }: Props) {
  if (latitude == null || longitude == null) return null;

  function handleNavigate(e: React.MouseEvent) {
    e.stopPropagation();
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const url = isIOS
      ? `https://maps.apple.com/?daddr=${latitude},${longitude}`
      : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={handleNavigate}
      aria-label={`Navigation zu ${label} starten`}
      title="Navigation starten"
      className="h-8 w-8 shrink-0"
    >
      <Navigation className="h-4 w-4" />
    </Button>
  );
}
