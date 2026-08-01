/**
 * OpenRouteService (ORS)-Helfer.
 *
 * ORS unterstützt zwei Schlüssel-Typen mit unterschiedlichem
 * Authorization-Header:
 *   - Kostenlose Standard-Keys (40-stelliger Hex-String) -> "apikey <key>"
 *   - Premium-Keys (JWT, beginnt mit "eyJ")              -> "Bearer <key>"
 *
 * Ein falscher Header führt zu HTTP 403 ("Access to this API has been
 * disallowed"), daher wird hier automatisch der passende Header gewählt.
 */
export function orsAuthorizationHeader(apiKey: string): string {
  return apiKey.startsWith("eyJ") ? `Bearer ${apiKey}` : `apikey ${apiKey}`;
}
