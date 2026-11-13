/** Hilfsfunktionen für den Supabase-Storage-Bucket "item-photos". */

export const ITEM_PHOTOS_BUCKET = "item-photos";

/**
 * Liefert die öffentliche URL eines Item-Fotos (öffentlicher Bucket).
 * Gibt null zurück, wenn kein Pfad hinterlegt ist.
 */
export function itemPhotoUrl(photoPath: string | null | undefined): string | null {
  if (!photoPath) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  // Analog zu lib/supabase/admin.ts einen evtl. vorhandenen /rest/v1-Suffix
  // (oder abschließenden Slash) entfernen.
  const cleanBase = base.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
  const cleanPath = photoPath.replace(/^\/+/, "");
  return `${cleanBase}/storage/v1/object/public/${ITEM_PHOTOS_BUCKET}/${cleanPath}`;
}
