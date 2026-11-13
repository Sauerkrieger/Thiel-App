import { NextResponse } from "next/server";
import { requireUser, isAdmin, usernameToEmail, emailToUsername, isUserRole } from "@/lib/auth";
import { CONTRACT_DEFAULTS, isContractType } from "@/lib/contract";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { parseClientUpdatedAt } from "@/lib/lww";
import type { ContractType, Database, Profile } from "@/types/database";

export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;

/** GET /api/auth/users – Liste aller Nutzer (nur Admin). */
export async function GET() {
  const result = await requireUser();
  if (!result.user) return unauthorized(result);
  if (!isAdmin(result.user)) return forbidden();

  try {
    const admin = getSupabaseAdmin();
    const [{ data, error }, { data: assignments }] = await Promise.all([
      admin.from("profiles").select("id, name, role, email, created_at, contract_type, weekly_target_hours, working_days_per_week, vacation_days_per_year").order("name"),
      admin.from("object_assignments").select("user_id, object_id"),
    ]);

    if (error) throw error;

    // Zugewiesene Objekte je Nutzer (für die Benutzerverwaltung).
    const objectIdsByUser = new Map<string, string[]>();
    for (const assignment of assignments ?? []) {
      const list = objectIdsByUser.get(assignment.user_id) ?? [];
      list.push(assignment.object_id);
      objectIdsByUser.set(assignment.user_id, list);
    }

    const users = (data as Profile[]).map((p) => ({
      id: p.id,
      email: p.email,
      name: p.name,
      role: p.role,
      username: emailToUsername(p.email),
      created_at: p.created_at,
      contract_type: p.contract_type,
      weekly_target_hours: p.weekly_target_hours,
      working_days_per_week: p.working_days_per_week,
      vacation_days_per_year: p.vacation_days_per_year,
      object_ids: objectIdsByUser.get(p.id) ?? [],
    }));

    return NextResponse.json({ users });
  } catch {
    return NextResponse.json({ error: "Nutzer konnten nicht geladen werden." }, { status: 500 });
  }
}

/** POST /api/auth/users – neuen Nutzer anlegen (nur Admin). */
export async function POST(request: Request) {
  const result = await requireUser();
  if (!result.user) return unauthorized(result);
  if (!isAdmin(result.user)) return forbidden();

  try {
    const body = await request.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : username;
    const password = typeof body.password === "string" ? body.password : "";
    const role = isUserRole(body.role) ? body.role : "driver";
    const contractType: ContractType = isContractType(body.contract_type)
      ? body.contract_type
      : "full_time";
    const contractDefaults = CONTRACT_DEFAULTS[contractType];
    // Sollstunden/Arbeitstage/Urlaubstage: übermittelte Werte gewinnen,
    // sonst Auto-Fill-Defaults der Vertragsart.
    const weeklyTargetHours =
      typeof body.weekly_target_hours === "number" && Number.isFinite(body.weekly_target_hours)
        ? body.weekly_target_hours
        : contractDefaults.weekly_target_hours;
    const workingDaysPerWeek =
      typeof body.working_days_per_week === "number" && Number.isFinite(body.working_days_per_week)
        ? body.working_days_per_week
        : contractDefaults.working_days_per_week;
    const vacationDaysPerYear =
      typeof body.vacation_days_per_year === "number" && Number.isFinite(body.vacation_days_per_year)
        ? Math.round(body.vacation_days_per_year)
        : contractDefaults.vacation_days_per_year;

    // Plausibilitätsprüfung der Vertragswerte.
    if (
      weeklyTargetHours <= 0 ||
      weeklyTargetHours > 168 ||
      workingDaysPerWeek <= 0 ||
      workingDaysPerWeek > 7 ||
      vacationDaysPerYear < 0 ||
      vacationDaysPerYear > 365
    ) {
      return NextResponse.json(
        { error: "Ungültige Vertragswerte (Sollstunden 0–168, Arbeitstage 1–7, Urlaubstage 0–365)." },
        { status: 400 },
      );
    }
    const objectIds = Array.isArray(body.object_ids)
      ? (body.object_ids as unknown[]).filter(
          (id: unknown): id is string =>
            typeof id === "string" && id.length > 0,
        )
      : [];

    // Reinigungskräfte müssen mindestens einem Objekt zugeteilt werden.
    if (role === "facility_manager" && objectIds.length === 0) {
      return NextResponse.json(
        { error: "Reinigungskräfte müssen mindestens einem Objekt zugeteilt werden." },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdmin();

    // Zugewiesene Objekte müssen existieren (sonst sauberer 400 statt FK-500).
    if (objectIds.length > 0) {
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

    if (!username || !password) {
      return NextResponse.json(
        { error: "Benutzername und Passwort sind Pflichtfelder." },
        { status: 400 },
      );
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return NextResponse.json(
        { error: "Der Benutzername darf nur Buchstaben, Zahlen, Punkt, Strich und Unterstrich enthalten." },
        { status: 400 },
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.` },
        { status: 400 },
      );
    }

    const email = usernameToEmail(username);

    // Duplikat-Prüfung
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: `Der Benutzername "${username}" ist bereits vergeben.` },
        { status: 409 },
      );
    }

    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    });
    if (error) throw error;

    // Profil direkt pflegen (Trigger setzt name/role aus metadata).
    const clientUpdatedAt = parseClientUpdatedAt(body.client_updated_at);
    const profilePayload: Database["public"]["Tables"]["profiles"]["Update"] = {
      name,
      role,
      email,
      contract_type: contractType,
      weekly_target_hours: weeklyTargetHours,
      working_days_per_week: workingDaysPerWeek,
      vacation_days_per_year: vacationDaysPerYear,
    };
    if (clientUpdatedAt) {
      profilePayload.client_updated_at = clientUpdatedAt;
    }
    profilePayload.synced_at = new Date().toISOString();
    await admin.from("profiles").update(profilePayload).eq("id", created.user.id);

    // Objektzuweisungen der Reinigungskraft anlegen.
    if (objectIds.length > 0) {
      const { error: assignmentError } = await admin.from("object_assignments").insert(
        objectIds.map((object_id: string) => ({ user_id: created.user.id, object_id })),
      );
      if (assignmentError) throw assignmentError;
    }

    return NextResponse.json(
      {
        user: {
          id: created.user.id,
          email,
          name,
          role,
          username: emailToUsername(email),
          created_at: new Date().toISOString(),
          contract_type: contractType,
          weekly_target_hours: weeklyTargetHours,
          working_days_per_week: workingDaysPerWeek,
          vacation_days_per_year: vacationDaysPerYear,
          object_ids: objectIds,
        },
      },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json({ error: "Nutzer konnte nicht angelegt werden." }, { status: 500 });
  }
}

function unauthorized(result: { error: string; code: string }) {
  return NextResponse.json({ error: result.error, code: result.code }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: "Nur Admins dürfen das." }, { status: 403 });
}
