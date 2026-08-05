/**
 * Service Worker – Offline-App-Shell für Thiel Dienstleistungen.
 *
 * Macht die App auch ganz ohne Internet frisch nutzbar (Neu-Laden / neues
 * Öffnen), nachdem sie einmal online geladen wurde:
 *
 * - Gehashte Build-Assets (`/_next/static/*`) werden cache-first geladen
 *   (unveränderlich pro Deploy → sicher).
 * - Seiten (Navigationen) und RSC-Payloads (Client-Navigation) werden
 *   network-first mit Cache-Fallback geladen: online immer aktuell,
 *   offline die zuletzt geladene Version. Fehlt eine Seite komplett, wird
 *   die gecachte Startseite ausgeliefert – die App bootet und holt die
 *   Daten dann aus IndexedDB (offlineFetch).
 * - `/api/*` wird bewusst NICHT angefasst: dafür ist der offlineFetch-
 *   Wrapper zuständig (IndexedDB-Cache, Offline-Queue, Sync beim Reconnect).
 *
 * Hinweise:
 * - `Cache-Control: no-store` wird beim Cachen bewusst ignoriert: Next.js
 *   markiert dynamische Seiten genau so, und genau diese wollen wir für den
 *   Offline-Modus cachen (die Daten-Ebene läuft ohnehin über IndexedDB).
 * - `Set-Cookie` und `Vary` werden aus den gecachten Kopien entfernt: Ein
 *   alter Auth-Cookie aus dem Cache darf die aktuelle Session nicht
 *   überschreiben, und Vary würde das URL-basierte Matching stören.
 * - Pflege: Nach größeren Deploys `CACHE_NAME` erhöhen – alte Caches werden
 *   beim Aktivieren automatisch entfernt. Der erste Besuch muss online sein
 *   (ein Service Worker braucht einmal Internet).
 */

const CACHE_NAME = "thiel-shell-v1";

self.addEventListener("install", (event) => {
  // Startseite vorab cachen – letzte Ausweichmöglichkeit für Navigationen.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch("/");
        if (response.ok) await putInCache(new Request("/"), response);
      } catch {
        /* Offline beim Installieren gibt es nicht – trotzdem absichern */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Nur same-origin GETs ohne /api cachen (Auth & Daten laufen woanders). */
function isCacheable(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname === "/sw.js") return false;
  return true;
}

/** RSC-Payload (Client-Navigation) vom HTML trennen – sonst kollidieren
 *  beide unter derselben URL im Cache. */
function cacheKey(request) {
  const url = new URL(request.url);
  const isRsc =
    request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
  if (isRsc) url.searchParams.set("_sw", "rsc");
  return url.href;
}

/** Antwort cachen – ohne Set-Cookie/Vary (siehe Header-Kommentar oben). */
async function putInCache(request, response) {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.delete("vary");
  const body = await response.clone().arrayBuffer();
  const clean = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const cache = await caches.open(CACHE_NAME);
  await cache.put(cacheKey(request), clean);
}

/** Gehashte, unveränderliche Assets: Cache zuerst, sonst Netz. */
async function cacheFirst(request) {
  const cached = await caches.match(cacheKey(request));
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await putInCache(request, response);
  return response;
}

/** Seiten & RSC-Payloads: erst Netz (immer aktuell), bei Fehler Cache. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await putInCache(request, response);
    return response;
  } catch {
    const cached = await caches.match(cacheKey(request));
    if (cached) return cached;
    // Nichts für diese URL gecacht? Dann die Startseite – die App bootet
    // und die Daten kommen aus IndexedDB.
    const shell = await caches.match("/");
    return shell ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!isCacheable(request)) return;

  const url = new URL(request.url);
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
