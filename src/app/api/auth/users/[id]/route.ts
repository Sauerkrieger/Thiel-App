import { NextResponse } from "next/server";
import {
  requireUser,
  isAdmin,
  emailToUsername,
  isUserRole,
} from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkLww } from "@/lib/lww";
import { lwwConflictResponse } from "@/lib/http";
import type { Database, UserRole } from "@/types/database";

export const dynamic = "force-dynamic";

/** PATCH /api/auth/users/[id] – Rolle/Name ändern (nur Admin). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if (!result.user) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  if (!isAdmin(result.user)) {
    return NextResponse.json({ error: "Nur Admins dürfen das." }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : null;
    const role = isUserRole(body.role) ? body.role : null;

    if (!name && !role) {
      return NextResponse.json(
        { error: "Keine Änderungen übermittelt." },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdmin();

    // Kein Admin darf sich selbst die Admin-Rolle entziehen (letzter Admin-Schutz).
    if (id === result.user.id && role && role !== "admin") {
      const { count } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Du kannst dir selbst nicht die Admin-Rolle entziehen (letzter Admin)." },
          { status: 400 },
        );
      }
    }

    const update: {
      name?: string;
      role?: UserRole;
    } = {};
    if (name) update.name = name;
    if (role) update.role = role;

    // Last-Write-Wins auf dem Profil (Offline-Sync-Schutz)
    const lww = await checkLww(admin, "profiles", id, body.client_updated_at);
    if (lww.status === "conflict") {
      return lwwConflictResponse(lww.serverRecord);
    }

    const updatePayload: Database["public"]["Tables"]["profiles"]["Update"] = {
      ...update,
    };
    if (lww.status === "apply") {
      updatePayload.client_updated_at = lww.clientUpdatedAt;
    }
    updatePayload.synced_at = new Date().toISOString();

    const { data, error } = await admin
      .from("profiles")
      .update(updatePayload)
      .eq("id", id)
      .select("id, name, role, email, created_at")
      .single();
    if (error) throw error;

    return NextResponse.json({
      user: {
        id: data.id,
        email: data.email,
        name: data.name,
        role: data.role,
        username: emailToUsername(data.email),
        created_at: data.created_at,
      },
    });
  } catch {
    return NextResponse.json({ error: "Nutzer konnte nicht aktualisiert werden." }, { status: 500 });
  }
}

/** DELETE /api/auth/users/[id] – Nutzer löschen (nur Admin, nicht sich selbst). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if (!result.user) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  if (!isAdmin(result.user)) {
    return NextResponse.json({ error: "Nur Admins dürfen das." }, { status: 403 });
  }

  try {
    const { id } = await params;
    if (id === result.user.id) {
      return NextResponse.json(
        { error: "Du kannst deinen eigenen Account nicht löschen." },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdmin();
    // Passkeys & Profil werden per ON DELETE CASCADE entfernt.
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Nutzer konnte nicht gelöscht werden." }, { status: 500 });
  }
}
