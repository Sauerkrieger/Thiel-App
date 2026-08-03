import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Prüft, ob eine Adresse eine Hausnummer enthält (z. B. "Hauptstraße 12",
 * "12 Hauptstraße" oder "Haus 4"). Eine reine PLZ ("97072 Würzburg") oder
 * ein Ort ohne Nummer gilt NICHT als exakte Adresse.
 */
export function hasHouseNumber(address: string): boolean {
  const digitGroups = address.match(/\d+/g) ?? [];
  if (digitGroups.length === 0) return false;
  // Eine einzelne 5-stellige Zahl ist eine Postleitzahl, keine Hausnummer.
  return digitGroups.some((group) => group.length !== 5);
}
