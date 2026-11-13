import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_USER_EMAIL_HEADER,
  AUTH_USER_ID_HEADER,
} from "@/lib/auth-headers";
import type { Database } from "@/types/database";

/**
 * Session-Refresh + Cookie-Handling für die Next.js-Middleware.
 * Gibt sowohl die (ggf. mit neuen Session-Cookies versehene) Response
 * als auch den angemeldeten User zurück.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Angemeldeten Nutzer über Request-Header an Layout/Pages/API-Routen
  // durchreichen: `getCurrentUser()` kann dadurch den zweiten Auth-Call
  // (supabase.auth.getUser) komplett überspringen und spart so einen
  // Netzwerk-Roundtrip pro Seiten-Navigation und pro API-Request.
  const requestHeaders = new Headers(request.headers);
  if (user) {
    requestHeaders.set(AUTH_USER_ID_HEADER, user.id);
    if (user.email) requestHeaders.set(AUTH_USER_EMAIL_HEADER, user.email);
  } else {
    requestHeaders.delete(AUTH_USER_ID_HEADER);
    requestHeaders.delete(AUTH_USER_EMAIL_HEADER);
  }

  // Response mit den angepassten Request-Headern bauen; dabei die ggf. beim
  // Session-Refresh gesetzten Response-Cookies übernehmen (Cookie-Handling
  // der @supabase/ssr-Bibliothek bleibt unverändert gültig – die Original-
  // Set-Cookie-Header werden 1:1 übernommen, inkl. aller Attribute).
  const next = NextResponse.next({ request: { headers: requestHeaders } });
  const setCookies =
    typeof supabaseResponse.headers.getSetCookie === "function"
      ? supabaseResponse.headers.getSetCookie()
      : [];
  for (const header of setCookies) {
    next.headers.append("set-cookie", header);
  }

  return { supabaseResponse: next, user };
}
