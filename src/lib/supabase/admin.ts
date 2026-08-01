import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Fehler, wenn Supabase-Umgebungsvariablen fehlen.
 * Wird von den API-Routen zu einem 503er mit code "SUPABASE_NOT_CONFIGURED" gemacht.
 */
export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase ist nicht konfiguriert. Bitte NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY in .env.local setzen.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

let cachedClient: SupabaseClient<Database> | null = null;

/**
 * Admin-Client mit Service-Role-Key – umgeht RLS und darf NUR in
 * Server-/API-Kontexten verwendet werden (nie im Browser).
 */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (cachedClient) return cachedClient;

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!rawUrl || !serviceRoleKey) {
    throw new SupabaseNotConfiguredError();
  }

  // supabase-js hängt selbst "/rest/v1" an die Projekt-URL an. Steht in
  // der Umgebungsvariable bereits ein "/rest/v1/" (oder ein Slash am
  // Ende), entsteht ein doppelter Pfad -> PostgREST antwortet mit
  // PGRST125 "Invalid path specified in request URL". Daher normalisieren.
  const url = rawUrl.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");

  cachedClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cachedClient;
}
