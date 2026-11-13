import json, urllib.request, urllib.error, http.cookiejar, pathlib, datetime

BASE = "http://127.0.0.1:3000"
IDS = pathlib.Path(__file__).with_name("demo-ids.json")

def opener():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def call(op, path, payload=None, method=None, t=90):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data,
        method=method or ("POST" if data is not None else "GET"),
        headers={"Content-Type": "application/json"})
    try:
        with op.open(req, timeout=t) as r:
            b = r.read().decode()
            return r.status, (json.loads(b) if b.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]

def login(op, u, p):
    st, b = call(op, "/api/auth/login", {"username": u, "password": p})
    print(f"  login {u}: {st}")
    return st == 200

ids = json.loads(IDS.read_text())
obj_ids = ids["objects"]
today = datetime.date.today()
yesterday = today - datetime.timedelta(days=1)

admin = opener(); login(admin, "Admin", "bitte-aendern!")
st, d = call(admin, "/api/tours?date=" + today.isoformat())
for t in (d or {}).get("tours", []):
    if t.get("status") != "completed":
        print("  delete old tour:", call(admin, "/api/tours/" + t["id"], method="DELETE")[0])
st, d = call(admin, "/api/tours?date=" + yesterday.isoformat())
for t in (d or {}).get("tours", []):
    if t.get("status") != "completed":
        print("  delete old tour:", call(admin, "/api/tours/" + t["id"], method="DELETE")[0])

drv = opener()
if not login(drv, "Tom", "demo1234"):
    raise SystemExit("driver login failed")

def make_tour(date, count, status):
    st, b = call(drv, "/api/tours", {
        "status": "packing", "date": date.isoformat(), "start_time": "07:12",
        "warehouse_arrival": "06:55",
        "stops": [{"object_id": oid} for oid in obj_ids[:count]],
    })
    tid = (b or {}).get("tour", {}).get("id") if isinstance(b, dict) else None
    print(f"  tour {date} ({count} stops): {st} {tid}")
    return tid

def stops_of(tid):
    st, d = call(drv, f"/api/tours/{tid}")
    t = (d or {}).get("tour", {}) if isinstance(d, dict) else {}
    return sorted(t.get("tour_stops") or [], key=lambda x: x.get("stop_order") or 0)

# --- heute: laufende Tour ---
tour_today = make_tour(today, 6, "in_transit")
if tour_today:
    print("  start:", call(drv, f"/api/tours/{tour_today}", {"status": "in_transit", "start_time": "07:12"}, method="PATCH")[0])
    stops = stops_of(tour_today)
    for i, s in enumerate(stops[:2]):
        st2, _ = call(drv, f"/api/tours/{tour_today}/stops/{s['id']}",
                      {"is_delivered": True, "arrival_time": f"08:{10 + i * 12:02d}"}, method="PATCH")
        print(f"    stop {i+1}: {st2}")

now = datetime.datetime.now().astimezone()
clock_in = now.replace(hour=7, minute=5, second=0, microsecond=0)
st, b = call(drv, "/api/time-tracking/clock", {"action": "clock_in", "event_at": clock_in.isoformat()})
print("  clock_in:", st, str(b)[:120])

# --- gestern: abgeschlossene Tour + Zeiteintrag ---
tour_y = make_tour(yesterday, 4, "completed")
if tour_y:
    print("  start:", call(drv, f"/api/tours/{tour_y}", {"status": "in_transit", "start_time": "07:20"}, method="PATCH")[0])
    for i, s in enumerate(stops_of(tour_y)):
        call(drv, f"/api/tours/{tour_y}/stops/{s['id']}",
             {"is_delivered": True, "arrival_time": f"08:{5 + i * 9:02d}"}, method="PATCH")
    print("  complete:", call(drv, f"/api/tours/{tour_y}", {"status": "completed"}, method="PATCH")[0])

y = datetime.datetime.combine(yesterday, datetime.time(7, 3)).astimezone()
st, b = call(drv, "/api/time-tracking/entries", {
    "clock_in": y.isoformat(),
    "clock_out": (y + datetime.timedelta(hours=8, minutes=12)).isoformat(),
    "break_duration_minutes": 30,
})
print("  yesterday entry:", st, str(b)[:120])

ids.update({"tour_today": tour_today, "tour_yesterday": tour_y})
IDS.write_text(json.dumps(ids, indent=2), encoding="utf-8")
print("done")
