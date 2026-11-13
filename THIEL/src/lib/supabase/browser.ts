"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

/**
 * Supabase-Client für den Browser (nur Client-Komponenten).
 *
 * Bewusst `createBrowserClient` aus @supabase/ssr statt `createClient` aus
 * supabase-js: Der Login dieser App läuft komplett über Session-Cookies
 * (Login-Route + Middleware, siehe src/lib/supabase/server.ts).
 * createBrowserClient liest genau diese Cookies und hängt das Access-Token
 * automatisch an die Realtime-Verbindung an. Ohne das Token verbindet sich
 * Realtime anonym und die RLS-Policies filtern sämtliche Events raus.
 */
export function getSupabaseBrowser() {
  if (browserClient) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase-Umgebungsvariablen fehlen.");
  }
  browserClient = createBrowserClient<Database>(url, anonKey);
  return browserClient;
}
