import { NextResponse } from "next/server";
import { SupabaseNotConfiguredError } from "@/lib/supabase/admin";
import type { ObjectCategory } from "@/types/database";

export const OBJECT_CATEGORIES: readonly ObjectCategory[] = [
  "objekt",
  "treppenhaus",
];

export function isObjectCategory(value: unknown): value is ObjectCategory {
  return (
    typeof value === "string" &&
    (OBJECT_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Validiert einen Breitengrad (-90 bis 90); ungültige Werte -> null. */
export function validLatitude(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= -90 &&
    value <= 90
    ? value
    : null;
}

/** Validiert einen Längengrad (-180 bis 180); ungültige Werte -> null. */
export function validLongitude(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= -180 &&
    value <= 180
    ? value
    : null;
}

/**
 * Einheitliches Fehlerformat aller API-Routen.
 * Supabase-Konfigurationsfehler -> 503 + code "SUPABASE_NOT_CONFIGURED".
 */
/**
 * Holt eine lesbare Fehlermeldung aus beliebigen geworfenen Werten
 * (Error-Instanzen, aber auch plain Objects mit .message).
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const maybe = (error as { message?: unknown }).message;
    if (typeof maybe === "string" && maybe.trim()) return maybe.trim();
  }
  return "Unbekannter Fehler";
}

/**
 * 409-Antwort bei einem LWW-Konflikt (Last-Write-Wins).
 * Der Client übernimmt daraufhin `serverRecord` lokal und verwirft seine
 * eigene, ältere Version (siehe OFFLINE_SYNC_PLAN.md).
 */
export function lwwConflictResponse(serverRecord: unknown) {
  return NextResponse.json(
    {
      error: "Datensatz wurde auf einem anderen Gerät neuer bearbeitet.",
      code: "CONFLICT",
      serverRecord,
    },
    { status: 409 },
  );
}

/**
 * Einheitliches Fehlerformat aller API-Routen.
 * Supabase-Konfigurationsfehler -> 503 + code "SUPABASE_NOT_CONFIGURED".
 */
export function apiErrorResponse(error: unknown) {
  if (error instanceof SupabaseNotConfiguredError) {
    return NextResponse.json(
      { error: error.message, code: "SUPABASE_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { error: extractErrorMessage(error) },
    { status: 500 },
  );
}
