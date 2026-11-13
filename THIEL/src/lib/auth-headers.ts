/**
 * Request-Header-Namen, über die die Middleware den angemeldeten Nutzer an
 * Layout/Pages/API-Routen durchreicht. Damit können diese den teuren zweiten
 * Supabase-Auth-Call (`supabase.auth.getUser()`) überspringen – das spart pro
 * Seiten-Navigation und pro API-Request einen Netzwerk-Roundtrip.
 *
 * Bewusst in einer eigenen Datei ohne `server-only`, damit sie sowohl von der
 * Edge-Middleware als auch von Node-Servermodulen importiert werden kann.
 */
export const AUTH_USER_ID_HEADER = "x-thiel-user-id";
export const AUTH_USER_EMAIL_HEADER = "x-thiel-user-email";
