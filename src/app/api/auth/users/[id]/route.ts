import { NextResponse } from "next/server";
import {
  requireUser,
  isAdmin,
  emailToUsername,
  isUserRole,
} from "@/lib/auth";
import { isContractType } from "@/lib/contract";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkLww } from "@/lib/lww";
import { lwwConflictResponse } from "@/lib/http";
import type { ContractType, Database, UserRole } from "@/types/database";

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
    const contractType = isContractType(body.contract_type)
      ? body.contract_type
      : undefined;
    const rawObjectIds: unknown = Array.isArray(body.object_ids) ? body.object_ids : undefined;
    const objectIds = Array.isArray(rawObjectIds)
      ? rawObjectIds.filter((oid: unknown): oid is string => typeof oid === "string" && oid.length > 0)
      : undefined;

    // Kontokorrektur (Zeitadmin): Urlaubsanspruch & Überstunden
    const vacationDaysTotal =
      typeof body.vacation_days_total === "number"
        ? body.vacation_days_total
        : undefined;
    const overtimeHours =
      typeof body.overtime_hours === "number" ? body.overtime_hours : undefined;
    if (
      vacationDaysTotal !== undefined &&
      (!Number.isInteger(vacationDaysTotal) ||
        vacationDaysTotal < 0 ||
        vacationDaysTotal > 365)
    ) {
      return NextResponse.json(
        { error: "Ungültiger Urlaubsanspruch (0–365 Tage)." },
        { status: 400 },
      );
    }
    if (
      overtimeHours !== undefined &&
      (!Number.isFinite(overtimeHours) ||
        overtimeHours < -1000 ||
        overtimeHours > 1000)
    ) {
      return NextResponse.json(
        { error: "Ungültiger Überstundenwert (-1000 bis 1000 h)." },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdmin();

    // Reinigungskräfte müssen mindestens einem Objekt zugeteilt werden
    // (gilt beim Anlegen und wenn die Rolle auf Reinigungskraft wechselt).
    if (role === "facility_manager") {
      if (objectIds !== undefined && objectIds.length === 0) {
        return NextResponse.json(
          { error: "Reinigungskräfte müssen mindestens einem Objekt zugeteilt werden." },
          { status: 400 },
        );
      }
      // Ohne übermittelte Objektliste: Prüfen, ob bereits Zuweisungen existieren.
      if (objectIds === undefined) {
        const { count, error: countError } = await admin
          .from("object_assignments")
          .select("id", { count: "exact", head: true })
          .eq("user_id", id);
        if (countError) throw countError;
        if ((count ?? 0) === 0) {
          return NextResponse.json(
            { error: "Reinigungskräfte müssen mindestens einem Objekt zugeteilt werden." },
            { status: 400 },
          );
        }
      }
    }

    if (!name && !role && contractType === undefined && vacationDaysTotal === undefined && overtimeHours === undefined && objectIds === undefined) {
      return NextResponse.json(
        { error: "Keine Änderungen übermittelt." },
        { status: 400 },
      );
    }

    // Zugewiesene Objekte müssen existieren (sonst sauberer 400 statt FK-500).
    if (objectIds !== undefined && objectIds.length > 0) {
      const { count, error: countError } = await admin
        .from("objects")
        .select("id", { count: "exact", head: true })
        .in("id", objectIds);
      if (countError) throw countError;
      if ((count ?? 0) !== objectIds.length) {
        return NextResponse.json(
          { error: "Mindestens ein zugewiesenes Objekt existiert nicht." },
          { status: 400 },
        );
      }
    }

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
      contract_type?: ContractType;
      vacation_days_total?: number;
      overtime_hours?: number;
    } = {};
    if (name) update.name = name;
    if (role) update.role = role;
    if (contractType !== undefined) update.contract_type = contractType;
    if (vacationDaysTotal !== undefined) update.vacation_days_total = vacationDaysTotal;
    if (overtimeHours !== undefined) update.overtime_hours = Math.round(overtimeHours * 100) / 100;

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
      .select("id, name, role, email, created_at, vacation_days_total, vacation_days_used, overtime_hours, contract_type")
      .single();
    if (error) throw error;

    // Objektzuweisungen einer Reinigungskraft: ersetzt werden sie, wenn der
    // Admin Objekte übermittelt (Rolle = facility_manager). Wechselt die Rolle
    // von Reinigungskraft auf etwas anderes, werden alle Zuweisungen entfernt.
    // Reine Namens-/Kontokorrekturen lassen die Zuweisungen unangetastet.
    let resultObjectIds: string[] = [];
    if (objectIds !== undefined) {
      const nextObjectIds: string[] =
        role !== "admin" && role !== "driver" ? objectIds : [];
      const { error: deleteError } = await admin
        .from("object_assignments")
        .delete()
        .eq("user_id", id);
      if (deleteError) throw deleteError;
      if (nextObjectIds.length > 0) {
        const { error: insertError } = await admin
          .from("object_assignments")
          .insert(nextObjectIds.map((object_id: string) => ({ user_id: id, object_id })));
        if (insertError) throw insertError;
      }
      resultObjectIds = nextObjectIds;
    } else if (role !== null && role !== "facility_manager") {
      // Wechsel weg von der Reinigungskraft: Zuweisungen löschen.
      const { error: deleteError } = await admin
        .from("object_assignments")
        .delete()
        .eq("user_id", id);
      if (deleteError) throw deleteError;
    } else {
      // Nicht übermittelt: bestehende Zuweisungen zurückgeben.
      const { data: assignments } = await admin
        .from("object_assignments")
        .select("object_id")
        .eq("user_id", id);
      resultObjectIds = (assignments ?? []).map((a) => a.object_id);
    }

    return NextResponse.json({
      user: {
        id: data.id,
        email: data.email,
        name: data.name,
        role: data.role,
        username: emailToUsername(data.email),
        created_at: data.created_at,
        contract_type: data.contract_type,
        object_ids: resultObjectIds,
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
