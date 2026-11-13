import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** DELETE /api/auth/passkeys/[id] – eigenen Passkey entfernen. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if (!result.user) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.status },
    );
  }

  try {
    const { id } = await params;
    const admin = getSupabaseAdmin();
    // Nur der eigene Passkey darf gelöscht werden.
    const { error } = await admin
      .from("passkeys")
      .delete()
      .eq("id", id)
      .eq("user_id", result.user.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Passkey konnte nicht gelöscht werden." },
      { status: 500 },
    );
  }
}
