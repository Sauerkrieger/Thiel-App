import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Anzeige-Referenz auf ein Profil (Name/Rolle) für Zeit-Enträge/Anträge.
 */
export type ProfileRef = {
  name?: string;
  role?: string;
};

/**
 * Lädt ein id → {name, role}-Mapping für die angegebenen Nutzer-IDs.
 *
 * Wird verwendet, um Stempelungen und Anträgen den Mitarbeiternamen für die
 * Anzeige zuzuordnen, ohne eine PostgREST-Embedded-Relation zu benötigen:
 * `time_entries.user_id` referenziert `auth.users`, nicht `profiles` – ein
 * `profiles:user_id(...)`-Select scheitert deshalb mit "Could not find a
 * relationship between 'time_entries' and 'user_id'".
 */
export async function loadProfileRefs(
  userIds: string[],
): Promise<Map<string, ProfileRef>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  const map = new Map<string, ProfileRef>();
  if (unique.length === 0) return map;

  const { data, error } = await getSupabaseAdmin()
    .from("profiles")
    .select("id, name, role")
    .in("id", unique);
  if (error) throw error;

  for (const profile of data ?? []) {
    map.set(profile.id, { name: profile.name, role: profile.role });
  }
  return map;
}
