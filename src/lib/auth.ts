import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  AUTH_USER_EMAIL_HEADER,
  AUTH_USER_ID_HEADER,
} from "@/lib/auth-headers";
import type { UserRole } from "@/types/database";

/** Domain, auf die Benutzernamen gemappt werden (Leon -> leon@thiel.local). */
export const USER_EMAIL_DOMAIN = "thiel.local";

/** Benutzername -> E-Mail (Login-Kennung). */
export function usernameToEmail(username: string): string {
  const normalized = username.trim().toLowerCase().replace(/\s+/g, "");
  return `${normalized}@${USER_EMAIL_DOMAIN}`;
}

/** E-Mail -> Benutzername (Anzeige & Bearbeitung). */
export function emailToUsername(email: string | null | undefined): string {
  if (!email) return "";
  const local = email.split("@")[0] ?? "";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** Gültige Rollen für die Benutzerverwaltung. */
export const VALID_USER_ROLES: readonly UserRole[] = [
  "driver",
  "admin",
  "facility_manager",
  "substitute",
];

export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === "string" &&
    (VALID_USER_ROLES as readonly string[]).includes(value)
  );
}

export type CurrentUser = {
  id: string;
  email: string | null;
  name: string;
  role: UserRole;
  username: string;
};

/* ------------------------------------------------------------------ */
/* Profil-Cache (kurzlebig)                                            */
/* ------------------------------------------------------------------ */

type CachedProfile = {
  name: string;
  role: UserRole;
  email: string | null;
};

/**
 * Kurzzeit-Memoization der Profil-Query. Die Middleware validiert die Session
 * bereits pro Request; die Profilabfrage (Rolle/Name) wird hier zusätzlich
 * für ~60 s zwischengespeichert, damit Layout, Page und API-Routen sie nicht
 * für jeden Request erneut über das Netz holen. Rollen-/Namensänderungen
 * greifen dadurch binnen einer Minute bzw. sofort nach
 * `invalidateProfileCache()` (siehe API-Routen).
 */
const PROFILE_CACHE_TTL_MS = 60_000;
const profileCache = new Map<
  string,
  { expiresAt: number; profile: CachedProfile }
>();

function cachedProfileFor(userId: string): CachedProfile | null {
  const entry = profileCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    profileCache.delete(userId);
    return null;
  }
  return entry.profile;
}

function setProfileCache(userId: string, profile: CachedProfile): void {
  profileCache.set(userId, {
    expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
    profile,
  });
}

/** Profil-Cache verwerfen, damit Zugriffsrechte sofort greifen. */
export function invalidateProfileCache(userId?: string): void {
  if (userId) profileCache.delete(userId);
  else profileCache.clear();
}

/** Profil laden (mit Kurzzeit-Cache); null, wenn kein Profil existiert. */
async function fetchProfile(userId: string): Promise<CachedProfile | null> {
  const cached = cachedProfileFor(userId);
  if (cached) return cached;

  try {
    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from("profiles")
      .select("id, name, role, email")
      .eq("id", userId)
      .maybeSingle();
    if (!profile) return null;
    const result: CachedProfile = {
      name: profile.name ?? "",
      role: isUserRole(profile.role) ? profile.role : "driver",
      email: profile.email ?? null,
    };
    setProfileCache(userId, result);
    return result;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Aktueller Nutzer                                                    */
/* ------------------------------------------------------------------ */

/**
 * Holen den angemeldeten Nutzer inkl. Profil; null wenn nicht angemeldet.
 *
 * Performance: Die Middleware setzt pro Request den Nutzer per Header
 * (`x-thiel-user-id`/`x-thiel-user-email`). Ist der Header vorhanden, wird
 * der teure `supabase.auth.getUser()`-Call übersprungen und nur noch das
 * (kurzzeitig gecachte) Profil gelesen. Zusätzlich dedupliziert React.cache
 * den Aufruf innerhalb eines Requests – Layout und Page führen ihn damit nur
 * noch einmal aus statt zweimal.
 */
async function loadCurrentUser(): Promise<CurrentUser | null> {
  // 1) Header-Pfad (von der Middleware gesetzt) – ohne weiteren Roundtrip.
  let headerUserId: string | null = null;
  let headerEmail: string | null = null;
  try {
    const headerStore = await headers();
    headerUserId = headerStore.get(AUTH_USER_ID_HEADER);
    headerEmail = headerStore.get(AUTH_USER_EMAIL_HEADER);
  } catch {
    // Kein Request-Kontext (z. B. Build) → klassischer Pfad unten.
  }

  if (headerUserId) {
    const profile = await fetchProfile(headerUserId);
    if (profile) {
      return {
        id: headerUserId,
        email: profile.email ?? headerEmail,
        name: profile.name,
        role: profile.role,
        username: emailToUsername(profile.email ?? headerEmail),
      };
    }
    // Profil nicht (mehr) vorhanden → mit dem klassischen Pfad fortfahren,
    // damit der Nutzer nicht fälschlich ausgeloggt wird.
  }

  // 2) Klassischer Pfad (Fallback): Session aus dem Cookie validieren.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await fetchProfile(user.id);
  const email = profile?.email ?? user.email ?? null;
  return {
    id: user.id,
    email,
    name: profile?.name ?? user.user_metadata?.name ?? "",
    role: profile?.role ?? "driver",
    username: emailToUsername(email),
  };
}

export const getCurrentUser = cache(loadCurrentUser);

/** Aktueller Nutzer oder Standard-401-Antwort für API-Routen. */
export async function requireUser(): Promise<
  | { user: CurrentUser }
  | { user: null; status: number; error: string; code: string }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      user: null,
      status: 401,
      error: "Nicht angemeldet.",
      code: "UNAUTHENTICATED",
    };
  }
  return { user };
}

/** true, wenn der Nutzer Admin ist. */
export function isAdmin(user: CurrentUser): boolean {
  return user.role === "admin";
}

/** true, wenn der Nutzer Reinigungskraft ist. */
export function isFacilityManager(user: CurrentUser): boolean {
  return user.role === "facility_manager";
}

/**
 * true, wenn der Nutzer Touren planen darf (Fahrer, Springer oder Admin).
 * Springer (substitute) sieht das gleiche wie Fahrer UND Reinigungskraft –
 * als Planner erhält er damit die Tourenplanung/Historie der Fahrer.
 */
export function isPlanner(user: CurrentUser): boolean {
  return (
    user.role === "driver" ||
    user.role === "admin" ||
    user.role === "substitute"
  );
}
