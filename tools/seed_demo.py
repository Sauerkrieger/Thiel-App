import json, urllib.request, urllib.error, http.cookiejar, pathlib, datetime, time

BASE = "http://127.0.0.1:3000"
IDS = pathlib.Path(__file__).with_name("demo-ids.json")

def opener():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def call(op, path, payload=None, method=None, t=60):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data,
        method=method or ("POST" if data is not None else "GET"),
        headers={"Content-Type": "application/json"})
    try:
        with op.open(req, timeout=t) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if body.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]

def login(op, username, password):
    st, body = call(op, "/api/auth/login", {"username": username, "password": password})
    if st != 200:
        raise SystemExit(f"login {username} failed: {st} {body}")

OBJECTS = [
 ("Meyer & Sons Office", "12 Market Street, 10115 Example Town", 52.5301, 13.3849, 1201, "08:00",
  [("Printer paper A4", 5, "5 reams"), ("Coffee beans", 2, None), ("Hand soap", 3, "Refill packs")]),
 ("Northgate Dental Clinic", "48 Northgate Road, 10115 Example Town", 52.5352, 13.3901, 1202, "07:30",
  [("Nitrile gloves", 4, "Size M"), ("Surface wipes", 6, None)]),
 ("Lakeside Cafe", "3 Lake View, 10117 Example Town", 52.5245, 13.4012, 1203, "09:00",
  [("Oat milk", 12, "1 l cartons"), ("Paper cups", 8, None), ("Napkins", 4, None)]),
 ("Bright & Co Accountants", "77 King Street, 10117 Example Town", 52.5188, 13.3885, 1204, "08:00",
  [("Printer paper A4", 8, None), ("Toner black", 1, "HP 26A"), ("Staples", 2, None)]),
 ("Riverside Pharmacy", "9 Riverside Walk, 10119 Example Town", 52.5290, 13.4075, 1205, "07:45",
  [("Till rolls", 10, None), ("Hand sanitizer", 3, None)]),
 ("The Old Mill Bakery", "2 Mill Lane, 10119 Example Town", 52.5375, 13.4130, 1206, "06:30",
  [("Flour 25 kg", 2, None), ("Baking paper", 4, None)]),
 ("City Library", "1 Civic Square, 10178 Example Town", 52.5215, 13.4090, 1207, "08:30",
  [("Printer paper A4", 12, None), ("Book tape", 3, None), ("Cleaning cloths", 5, None)]),
 ("Harbour View Hotel", "20 Dockside, 10179 Example Town", 52.5120, 13.4180, 1208, "09:00",
  [("Toilet paper", 24, "Industrial rolls"), ("Bin bags 120 l", 10, None), ("Air freshener", 6, None)]),
 ("Green Park Kindergarten", "5 Park Crescent, 10179 Example Town", 52.5155, 13.3990, 1209, "07:00",
  [("Paper towels", 8, None), ("Hand soap", 6, None), ("Crayons", 4, "Boxes")]),
]

admin = opener()
login(admin, "Admin", "bitte-aendern!")

def list_objects():
    st, d = call(admin, "/api/objects")
    return d.get("objects", []) if isinstance(d, dict) else (d or [])

existing = {o["name"]: o["id"] for o in list_objects()}
obj_ids = []
for name, addr, lat, lon, key, opens, items in OBJECTS:
    if name in existing:
        obj_ids.append(existing[name]); print(f"  exists: {name}"); continue
    call(admin, "/api/objects", {
        "name": name, "address": addr, "latitude": lat, "longitude": lon,
        "category": "objekt", "key_number": key, "opens_at": opens,
        "items": [{"item_name": n, "quantity": q, "note": note} for n, q, note in items],
    })
    found = next((o["id"] for o in list_objects() if o["name"] == name), None)
    print(f"  created: {name} -> {found}")
    if found: obj_ids.append(found)

st, d = call(admin, "/api/auth/users")
users = d.get("users", []) if isinstance(d, dict) else (d or [])
driver = next((u for u in users if str(u.get("username", "")).lower() == "tom"), None)
if driver:
    print("  driver exists:", driver["id"])
    call(admin, f"/api/auth/users/{driver['id']}", {"object_ids": obj_ids}, method="PATCH")
else:
    st, body = call(admin, "/api/auth/users", {
        "username": "tom", "name": "Tom Fisher", "password": "demo1234",
        "role": "driver", "contract_type": "full_time", "object_ids": obj_ids,
    })
    print("  driver created:", st, str(body)[:100])
    st, d = call(admin, "/api/auth/users")
    users = d.get("users", []) if isinstance(d, dict) else (d or [])
    driver = next((u for u in users if str(u.get("username", "")).lower() == "tom"), None)
driver_id = driver["id"] if driver else None
print("  driver id:", driver_id)
if not driver_id:
    raise SystemExit("no driver")

today = datetime.date.today()
st, d = call(admin, "/api/tours?date=" + today.isoformat())
tours = d.get("tours", []) if isinstance(d, dict) else (d or [])
for t in tours:
    if t.get("date") == today.isoformat() and t.get("status") != "completed":
        print("  cleanup old tour:", t["id"], call(admin, f"/api/tours/{t['id']}", method="DELETE")[0])

st, body = call(admin, "/api/tours", {
    "status": "packing", "start_time": "07:12", "warehouse_arrival": "06:55",
    "driver_id": driver_id, "date": today.isoformat(),
    "stops": [{"object_id": oid} for oid in obj_ids[:6]],
})
tour_id = (body or {}).get("tour", {}).get("id") if isinstance(body, dict) else None
print("  tour:", st, tour_id)
if not tour_id:
    st, d = call(admin, "/api/tours?date=" + today.isoformat())
    tours = d.get("tours", []) if isinstance(d, dict) else (d or [])
    tour_id = next((t["id"] for t in tours if t.get("driver_id") == driver_id), None)
print("  tour id:", tour_id)

drv = opener()
login(drv, "Tom", "demo1234")
now = datetime.datetime.now().astimezone()
clock_in = now.replace(hour=7, minute=5, second=0, microsecond=0)
st, body = call(drv, "/api/time-tracking/entries", {"clock_in": clock_in.isoformat(), "note": "Morning shift"})
print("  clock in:", st, str(body)[:100])
if tour_id:
    st, body = call(drv, f"/api/tours/{tour_id}", {"status": "in_transit", "start_time": "07:12"}, method="PATCH")
    print("  tour started:", st, str(body)[:100])
    st, d = call(drv, f"/api/tours/{tour_id}")
    t = d.get("tour", {}) if isinstance(d, dict) else {}
    stops = sorted(t.get("tour_stops") or [], key=lambda x: x.get("stop_order") or 0)
    for i, s in enumerate(stops[:2]):
        st2, _ = call(drv, f"/api/tours/{tour_id}/stops/{s['id']}",
                      {"is_delivered": True, "arrival_time": f"08:{10 + i * 12:02d}"}, method="PATCH")
        print(f"    stop {i+1} delivered: {st2}")

IDS.write_text(json.dumps({"objects": obj_ids, "driver_id": driver_id, "tour_id": tour_id}, indent=2), encoding="utf-8")
print("saved", IDS)
