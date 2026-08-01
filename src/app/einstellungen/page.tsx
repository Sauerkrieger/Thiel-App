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

  // Nutzerliste (nur für Admins).
  let users: {
    id: string;
    name: string;
    role: string;
    email: string | null;
    username: string;
    created_at: string;
  }[] = [];
  if (isAdmin(user)) {
    const { data } = await admin
      .from("profiles")
      .select("id, name, role, email, created_at")
      .order("name");
    users = (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      email: p.email,
      username: p.email?.split("@")[0] ?? "",
      created_at: p.created_at,
    }));
  }

  return (
    <SettingsPage
      user={user}
      passkeys={passkeys ?? []}
      users={users}
      isAdmin={isAdmin(user)}
    />
  );
}
