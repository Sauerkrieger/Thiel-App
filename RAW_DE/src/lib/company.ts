/**
 * Zentrale Firmen-Konfiguration.
 *
 * Alle unternehmensspezifischen Werte kommen aus Umgebungsvariablen (siehe
 * `.env.local.example`), damit derselbe Code ohne Änderungen von einer anderen
 * Firma übernommen werden kann. `NEXT_PUBLIC_*`-Variablen stehen auch im
 * Browser zur Verfügung.
 */

/** Anzeigename der Firma (Header, Login, Seitentitel, Passkeys). */
export const COMPANY_NAME =
  process.env.NEXT_PUBLIC_COMPANY_NAME?.trim() || "Musterfirma";

/**
 * Kurzform der Firma für Dateinamen (z. B. „Lohnexport_<slug>_…csv“).
 * Default: aus dem Firmennamen abgeleitet.
 */
export const COMPANY_SLUG =
  process.env.NEXT_PUBLIC_COMPANY_SLUG?.trim() ||
  COMPANY_NAME.toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") ||
  "firma";

/**
 * Domain, auf die Login-Benutzernamen gemappt werden
 * (Benutzername „max“ -> `max@<domain>`). Interne Kennung, keine echte Mail.
 */
export const USER_EMAIL_DOMAIN =
  process.env.NEXT_PUBLIC_USER_EMAIL_DOMAIN?.trim() || "company.local";
