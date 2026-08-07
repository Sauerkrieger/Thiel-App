import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
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
  "cleaner",
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

/** Holen den angemeldeten Nutzer inkl. Profil; null wenn nicht angemeldet. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, name, role, email")
    .eq("id", user.id)
    .maybeSingle();

  const email = profile?.email ?? user.email ?? null;
  return {
    id: user.id,
    email,
    name: profile?.name ?? user.user_metadata?.name ?? "",
    role: profile?.role ?? "driver",
    username: emailToUsername(email),
  };
}

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

/** true, wenn der Nutzer Objektbetreuer ist. */
export function isFacilityManager(user: CurrentUser): boolean {
  return user.role === "facility_manager";
}

/**
 * true, wenn der Nutzer Touren planen darf (Fahrer, Springer oder Admin).
 * Springer (substitute) sieht das gleiche wie Fahrer UND Objektbetreuer –
 * als Planner erhält er damit die Tourenplanung/Historie der Fahrer.
 */
export function isPlanner(user: CurrentUser): boolean {
  return (
    user.role === "driver" ||
    user.role === "admin" ||
    user.role === "substitute"
  );
}
