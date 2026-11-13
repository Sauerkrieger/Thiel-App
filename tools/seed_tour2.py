import json, urllib.request, urllib.error, http.cookiejar, pathlib, datetime, subprocess

BASE = "http://127.0.0.1:3000"
IDS = pathlib.Path(__file__).with_name("demo-ids.json")
ids = json.loads(IDS.read_text())
env = {}
for line in open(pathlib.Path(__file__).parent.parent / "RAW_EN/.env.local"):
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1); env[k.strip()] = v.strip().strip('"')

def rest(path, payload=None, method="GET"):
    cmd = ["curl", "-s", "--max-time", "20", env["NEXT_PUBLIC_SUPABASE_URL"] + "/rest/v1/" + path,
           "-H", "apikey: " + env["SUPABASE_SERVICE_ROLE_KEY"],
           "-H", "Authorization: Bearer " + env["SUPABASE_SERVICE_ROLE_KEY"],
           "-H", "Content-Type: application/json"]
    if payload is not None:
        cmd += ["-X", method, "-d", json.dumps(payload), "-H", "Prefer: return=representation"]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    try: return json.loads(out) if out.strip() else None
    except Exception: return out[:200]

def opener():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def call(op, path, payload=None, method=None, t=90):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data,
        method=method or ("POST" if data is not None else "GET"),
        headers={"Content-Type": "application/json"})
    try:
        with op.open(req, timeout=t) as r:
            b = r.read().decode(); return r.status, (json.loads(b) if b.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]

today = datetime.date.today()
yesterday = today - datetime.timedelta(days=1)

admin = opener(); call(admin, "/api/auth/login", {"username": "Admin", "password": "bitte-aendern!"})
st, d = call(admin, "/api/tours")
for t in (d or {}).get("tours", []):
    print("  delete tour", t["id"], call(admin, "/api/tours/" + t["id"], method="DELETE")[0])

drv = opener(); print("  login Tom:", call(drv, "/api/auth/login", {"username": "Tom", "password": "demo1234"})[0])

def stops_of(tid):
    st, d = call(drv, f"/api/tours/{tid}")
    t = (d or {}).get("tour", {}) if isinstance(d, dict) else {}
    return sorted(t.get("tour_stops") or [], key=lambda x: x.get("stop_order") or 0)

def create(count):
    st, b = call(drv, "/api/tours", {"status": "packing", "start_time": "07:12", "warehouse_arrival": "06:55",
                                    "stops": [{"object_id": o} for o in ids["objects"][:count]]})
    return (b or {}).get("tour", {}).get("id") if isinstance(b, dict) else None

# 1) gestrige, abgeschlossene Tour
a = create(4); print("  tour A:", a)
call(drv, f"/api/tours/{a}", {"status": "in_transit", "start_time": "07:20"}, method="PATCH")
for i, s in enumerate(stops_of(a)):
    call(drv, f"/api/tours/{a}/stops/{s['id']}", {"is_delivered": True, "arrival_time": f"08:{5+i*9:02d}"}, method="PATCH")
print("  complete A:", call(drv, f"/api/tours/{a}", {"status": "completed"}, method="PATCH")[0])
print("  datiere A auf gestern:", rest(f"active_tours?id=eq.{a}", {"date": yesterday.isoformat()}, "PATCH"))

# 2) heutige, laufende Tour
b = create(6); print("  tour B:", b)
call(drv, f"/api/tours/{b}", {"status": "in_transit", "start_time": "07:12"}, method="PATCH")
for i, s in enumerate(stops_of(b)[:2]):
    st2, _ = call(drv, f"/api/tours/{b}/stops/{s['id']}", {"is_delivered": True, "arrival_time": f"08:{10+i*12:02d}"}, method="PATCH")
    print(f"    stop {i+1}: {st2}")

# 3) Einstempeln falls nötig
st, d = call(drv, "/api/time-tracking/entries?date=" + today.isoformat())
open_entry = None
for e in (d or {}).get("entries", []) if isinstance(d, dict) else (d or []):
    if not e.get("clock_out"): open_entry = e
if open_entry:
    print("  already clocked in:", open_entry["id"])
else:
    now = datetime.datetime.now().astimezone().replace(hour=7, minute=5, second=0, microsecond=0)
    print("  clock_in:", call(drv, "/api/time-tracking/clock", {"action": "clock_in", "event_at": now.isoformat()})[0])

ids.update({"tour_today": b, "tour_yesterday": a})
IDS.write_text(json.dumps(ids, indent=2), encoding="utf-8")
print("  tours in DB:", [(t["date"], t["status"]) for t in (rest("active_tours?select=date,status&order=date") or [])])
