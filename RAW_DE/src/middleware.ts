import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Öffentliche Routen, die ohne Anmeldung erreichbar sind:
 *  - Login-Seite
 *  - Login-/Passkey-API (die Passkey-Verifikation läuft ohne Session)
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/passkeys/login-options",
  "/api/auth/passkeys/login-verify",
];

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // Nicht angemeldet:
  if (!user && !isPublic) {
    // API-Routen bekommen einen sauberen 401er statt eines Redirects.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Nicht angemeldet.", code: "UNAUTHENTICATED" },
        { status: 401 },
      );
    }
    // Seiten-Routen -> /login weiterleiten (mit Rückkehr-Ziel).
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Bereits angemeldete Nutzer von der Login-Seite wegschicken.
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Alles außer statischen Assets & Next-interne Routen absichern.
    // sw.js muss ohne Session erreichbar sein (Service-Worker-Registrierung
    // passiert auch auf der Login-Seite, siehe public/sw.js).
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
