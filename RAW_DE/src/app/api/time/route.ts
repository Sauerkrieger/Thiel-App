import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/time – Serverzeit (ISO 8601).
 * Wird vom Client für die Clock-Skew-Berechnung verwendet:
 * timeOffset = serverTime - localClientTime
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  }
  return NextResponse.json({ serverTime: new Date().toISOString() });
}
