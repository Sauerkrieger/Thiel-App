"""Löscht alle Demo-Daten (Objekte, Touren, Fahrer Tom, Zeiteinträge) rückstandsfrei."""
import json, urllib.request, urllib.error, http.cookiejar, pathlib, sys

BASE = "http://127.0.0.1:3000"
IDS = pathlib.Path(__file__).with_name("demo-ids.json")

def opener():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def call(op, path, payload=None, method=None, t=90):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data,
        method=method or ("DELETE" if method is None and data is None else "POST"),
        headers={"Content-Type": "application/json"})
    try:
        with op.open(req, timeout=t) as r:
            b = r.read().decode()
            return r.status, (json.loads(b) if b.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]

def login(op, u, p):
    st, _ = call(op, "/api/auth/login", {"username": u, "password": p}, method="POST")
    print(f"  login {u}: {st}")

ids = json.loads(IDS.read_text()) if IDS.exists() else {}
admin = opener(); login(admin, "Admin", "bitte-aendern!")

# Touren (heute + gestern, alle offenen)
st, d = call(admin, "/api/tours")
for t in (d or {}).get("tours", []):
    if t.get("id") in {ids.get("tour_today"), ids.get("tour_yesterday"), ids.get("tour_id")}:
        print("  tour deleted:", t.get("date"), call(admin, "/api/tours/" + t["id"])[0])

# Zeiteinträge des Fahrers
st, d = call(admin, "/api/admin/time-tracking/overview")
rows = (d or {}).get("entries", []) if isinstance(d, dict) else []
for e in rows:
    if e.get("user_id") == ids.get("driver_id") and not e.get("clock_out"):
        print("  open entry:", e["id"], call(admin, f"/api/admin/time-tracking/entries/{e['id']}", payload={}, method="DELETE")[0])

# Objekte (auch Testreste)
st, d = call(admin, "/api/objects")
wanted = set(ids.get("objects", []))
for o in (d or {}).get("objects", []):
    if o["id"] in wanted or o["name"].startswith("Probe "):
        print("  object deleted:", o["name"], call(admin, "/api/objects/" + o["id"])[0])

# Fahrer
if ids.get("driver_id"):
    print("  driver deleted:", call(admin, "/api/auth/users/" + ids["driver_id"])[0])

IDS.unlink(missing_ok=True)
print("cleanup done")
