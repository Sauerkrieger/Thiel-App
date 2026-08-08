import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { SettingsPage } from "@/components/settings/settings-page";

export const metadata: Metadata = {
  title: "Einstellungen",
};

export default async function EinstellungenPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = getSupabaseAdmin();

  // Eigene Passkeys.
  const { data: passkeys } = await admin
    .from("passkeys")
    .select("id, created_at, last_used_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // Nutzerliste (nur für Admins) + Objektliste für die Zuweisung an
  // Reinigungskräfte.
  let users: {
    id: string;
    name: string;
    role: string;
    email: string | null;
    username: string;
    created_at: string;
    contract_type: string;
    weekly_target_hours: number | null;
    working_days_per_week: number | null;
    vacation_days_per_year: number | null;
    object_ids: string[];
  }[] = [];
  let objects: { id: string; name: string }[] = [];
  if (isAdmin(user)) {
    const [{ data: profileData }, { data: objectData }, { data: assignmentData }] =
      await Promise.all([
        admin.from("profiles").select("id, name, role, email, created_at, contract_type, weekly_target_hours, working_days_per_week, vacation_days_per_year").order("name"),
        admin.from("objects").select("id, name").order("name"),
        admin.from("object_assignments").select("user_id, object_id"),
      ]);
    const objectIdsByUser = new Map<string, string[]>();
    for (const assignment of assignmentData ?? []) {
      const list = objectIdsByUser.get(assignment.user_id) ?? [];
      list.push(assignment.object_id);
      objectIdsByUser.set(assignment.user_id, list);
    }
    users = (profileData ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      email: p.email,
      username: p.email?.split("@")[0] ?? "",
      created_at: p.created_at,
      contract_type: p.contract_type ?? "full_time",
      weekly_target_hours: p.weekly_target_hours ?? null,
      working_days_per_week: p.working_days_per_week ?? null,
      vacation_days_per_year: p.vacation_days_per_year ?? null,
      object_ids: objectIdsByUser.get(p.id) ?? [],
    }));
    objects = (objectData ?? []).map((o) => ({ id: o.id, name: o.name }));
  }

  return (
    <SettingsPage
      user={user}
      passkeys={passkeys ?? []}
      users={users}
      objects={objects}
      isAdmin={isAdmin(user)}
    />
  );
}
