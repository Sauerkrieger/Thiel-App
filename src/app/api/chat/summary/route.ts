import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireUser, isAdmin } from "@/lib/auth";
import type { UserRole } from "@/types/database";
import { apiErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  try {
    const admin = getSupabaseAdmin();
    const userIsAdmin = isAdmin(auth.user);
    // Kontakte sind unabhängig von vorhandenen Threads. Dadurch bleibt die
    // Auswahl sichtbar, auch wenn noch kein Chat angelegt wurde.
    // Nicht-Admins (z. B. Fahrer) sehen neben Admins auch andere Mitarbeiter
    // als Kontakte (Peer-Chat, z. B. Fahrer ↔ Fahrer) – außer sich selbst.
    const contactRoles = userIsAdmin
      ? (["driver", "facility_manager", "substitute"] as UserRole[])
      : (["admin", "driver", "facility_manager", "substitute"] as UserRole[]);

    let contacts: Array<{ id: string; name: string; role: UserRole; phone?: string | null }> = [];
    const contactsWithPhone = await admin
      .from("profiles")
      .select("id, name, role, phone")
      .in("role", contactRoles)
      .neq("id", auth.user.id)
      .order("name");
    if (contactsWithPhone.error) {
      const contactsWithoutPhone = await admin
        .from("profiles")
        .select("id, name, role")
        .in("role", contactRoles)
        .neq("id", auth.user.id)
        .order("name");
      if (contactsWithoutPhone.error) throw contactsWithoutPhone.error;
      contacts = (contactsWithoutPhone.data ?? []) as typeof contacts;
    } else {
      contacts = (contactsWithPhone.data ?? []) as typeof contacts;
    }

    // Chat-Tabellen können auf einer noch nicht migrierten Umgebung fehlen.
    // Die Kontaktliste darf dadurch niemals ausfallen.
    const threadsResult = await admin.from("chat_threads").select("id, employee_id, admin_id, created_at").or(`employee_id.eq.${auth.user.id},admin_id.eq.${auth.user.id}`);
    const threads = threadsResult.error ? [] : (threadsResult.data ?? []);

    const ownWithLanguage = await admin.from("profiles").select("chat_preferred_language").eq("id", auth.user.id).maybeSingle();
    const preferredLanguage = ownWithLanguage.error ? null : ownWithLanguage.data?.chat_preferred_language ?? null;

    const threadIds = (threads ?? []).map((thread) => thread.id);
    const { data: unreadMessages, error: messageError } = threadIds.length
      ? await admin
        .from("chat_messages")
        .select("id, thread_id, status")
        .in("thread_id", threadIds)
        .neq("sender_id", auth.user.id)
        .neq("status", "read")
      : { data: [], error: null };
    // Ohne Chat-Tabelle bleibt der Kontaktbereich trotzdem nutzbar.
    if (messageError && !threadsResult.error) throw messageError;
    const profileById = new Map((contacts ?? []).map((contact) => [contact.id, contact]));
    const unreadByThread = new Map<string, number>();
    for (const message of unreadMessages ?? []) {
      unreadByThread.set(message.thread_id, (unreadByThread.get(message.thread_id) ?? 0) + 1);
    }
    const incoming = (unreadMessages ?? []).filter((message) => message.status === "sent").map((message) => message.id);
    if (incoming.length) await admin.from("chat_messages").update({ status: "delivered", delivered_at: new Date().toISOString() }).in("id", incoming);
    return NextResponse.json({ contacts: contacts ?? [], preferredLanguage, unreadCount: [...unreadByThread.values()].reduce((sum, count) => sum + count, 0), threads: (threads ?? []).map((thread) => ({ ...thread, contact: profileById.get(thread.employee_id === auth.user.id ? thread.admin_id : thread.employee_id) ?? null, unreadCount: unreadByThread.get(thread.id) ?? 0 })) });
  } catch (error) { return apiErrorResponse(error); }
}
