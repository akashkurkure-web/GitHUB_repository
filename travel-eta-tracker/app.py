#!/usr/bin/env python3
"""Travel ETA Tracker.

Asks for two places, resolves them with the Google Geocoding API, shows the
live (traffic-aware) travel time from the Google Routes API, and keeps
re-checking every tracked route on a fixed interval (hourly by default),
storing each sample in a local SQLite database.

Pure Python standard library - no pip install needed.

    export GOOGLE_MAPS_API_KEY=your-key
    python3 app.py            # then open http://localhost:8080
"""

import csv
import io
import json
import os
import random
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def load_dotenv(path):
    """Minimal .env loader so users can keep the key in a file."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv(BASE_DIR / ".env")

API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
MOCK = os.environ.get("MOCK_MODE", "").lower() in ("1", "true", "yes") or not API_KEY
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8080"))
INTERVAL_MINUTES = float(os.environ.get("CHECK_INTERVAL_MINUTES", "60"))
TRAVEL_MODE = os.environ.get("TRAVEL_MODE", "DRIVE").upper()
DB_PATH = Path(os.environ.get("DB_PATH", BASE_DIR / "eta_data.sqlite3"))

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"

db_lock = threading.Lock()


# ---------------------------------------------------------------- database

def db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db_lock, db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS routes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                origin_query TEXT NOT NULL,
                origin_address TEXT NOT NULL,
                origin_lat REAL NOT NULL,
                origin_lng REAL NOT NULL,
                dest_query TEXT NOT NULL,
                dest_address TEXT NOT NULL,
                dest_lat REAL NOT NULL,
                dest_lng REAL NOT NULL,
                travel_mode TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
                checked_at TEXT NOT NULL,
                duration_sec INTEGER,
                static_duration_sec INTEGER,
                distance_m INTEGER,
                error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_samples_route ON samples(route_id, checked_at);
            """
        )


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ------------------------------------------------------------ google maps

class MapsError(Exception):
    pass


def http_json(url, data=None, headers=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        try:
            detail = json.loads(detail).get("error", {}).get("message", detail)
        except (ValueError, AttributeError):
            pass
        raise MapsError(f"HTTP {e.code}: {detail}") from None
    except urllib.error.URLError as e:
        raise MapsError(f"Network error: {e.reason}") from None


def geocode(query):
    """Return (formatted_address, lat, lng) for a free-text place."""
    if MOCK:
        rnd = random.Random(query.lower())
        return f"{query} (mock)", 18.5 + rnd.random(), 73.8 + rnd.random()
    params = urllib.parse.urlencode({"address": query, "key": API_KEY})
    data = http_json(f"{GEOCODE_URL}?{params}")
    status = data.get("status")
    if status == "ZERO_RESULTS":
        raise MapsError(f"Google Maps could not find '{query}'")
    if status != "OK":
        raise MapsError(f"Geocoding failed ({status}): {data.get('error_message', '')}")
    top = data["results"][0]
    loc = top["geometry"]["location"]
    return top["formatted_address"], loc["lat"], loc["lng"]


def parse_duration(value):
    # Routes API returns durations like "1234s"
    return int(float(value.rstrip("s"))) if value else None


def fetch_eta(route):
    """Return (duration_sec, static_duration_sec, distance_m) right now."""
    if MOCK:
        base = 1800 + (route["id"] * 337) % 1800
        hour = datetime.now().hour
        rush = 1.6 if hour in (8, 9, 10, 17, 18, 19) else 1.0
        return int(base * rush * random.uniform(0.9, 1.15)), base, 25000
    body = {
        "origin": {"location": {"latLng": {"latitude": route["origin_lat"], "longitude": route["origin_lng"]}}},
        "destination": {"location": {"latLng": {"latitude": route["dest_lat"], "longitude": route["dest_lng"]}}},
        "travelMode": route["travel_mode"],
    }
    if route["travel_mode"] in ("DRIVE", "TWO_WHEELER"):
        body["routingPreference"] = "TRAFFIC_AWARE_OPTIMAL"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
    }
    data = http_json(ROUTES_URL, body, headers)
    routes = data.get("routes") or []
    if not routes:
        raise MapsError("No route found between these places for this travel mode")
    r = routes[0]
    return parse_duration(r.get("duration")), parse_duration(r.get("staticDuration")), r.get("distanceMeters")


# --------------------------------------------------------------- tracking

def record_sample(route):
    try:
        dur, static, dist = fetch_eta(route)
        err = None
    except MapsError as e:
        dur = static = dist = None
        err = str(e)
    sample = {"checked_at": now_iso(), "duration_sec": dur,
              "static_duration_sec": static, "distance_m": dist, "error": err}
    with db_lock, db() as conn:
        conn.execute(
            "INSERT INTO samples (route_id, checked_at, duration_sec, static_duration_sec, distance_m, error)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (route["id"], *sample.values()),
        )
    status = err or f"{dur // 60} min"
    print(f"[{sample['checked_at']}] route {route['id']}: {status}", flush=True)
    return sample


def scheduler_loop():
    """Wake up every interval and sample every active route."""
    interval = INTERVAL_MINUTES * 60
    while True:
        # Align to the next interval boundary (e.g. top of the hour for 60 min).
        time.sleep(interval - (time.time() % interval))
        with db_lock, db() as conn:
            active = conn.execute("SELECT * FROM routes WHERE active = 1").fetchall()
        for route in active:
            record_sample(dict(route))


def create_route(origin, destination, mode):
    o_addr, o_lat, o_lng = geocode(origin)
    d_addr, d_lat, d_lng = geocode(destination)
    with db_lock, db() as conn:
        cur = conn.execute(
            "INSERT INTO routes (origin_query, origin_address, origin_lat, origin_lng,"
            " dest_query, dest_address, dest_lat, dest_lng, travel_mode, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (origin, o_addr, o_lat, o_lng, destination, d_addr, d_lat, d_lng, mode, now_iso()),
        )
        route = dict(conn.execute("SELECT * FROM routes WHERE id = ?", (cur.lastrowid,)).fetchone())
    route["latest"] = record_sample(route)
    return route


def list_routes():
    with db_lock, db() as conn:
        routes = [dict(r) for r in conn.execute("SELECT * FROM routes ORDER BY id DESC")]
        for r in routes:
            latest = conn.execute(
                "SELECT checked_at, duration_sec, static_duration_sec, distance_m, error FROM samples"
                " WHERE route_id = ? ORDER BY id DESC LIMIT 1", (r["id"],)).fetchone()
            r["latest"] = dict(latest) if latest else None
            r["sample_count"] = conn.execute(
                "SELECT COUNT(*) FROM samples WHERE route_id = ?", (r["id"],)).fetchone()[0]
    return routes


def get_route(route_id):
    with db_lock, db() as conn:
        row = conn.execute("SELECT * FROM routes WHERE id = ?", (route_id,)).fetchone()
    return dict(row) if row else None


def get_samples(route_id):
    with db_lock, db() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT checked_at, duration_sec, static_duration_sec, distance_m, error"
            " FROM samples WHERE route_id = ? ORDER BY id", (route_id,))]


# ------------------------------------------------------------------- http

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep the console for ETA logs

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return {}

    def route_id(self, parts):
        try:
            return int(parts[2])
        except (IndexError, ValueError):
            return None

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        parts = path.strip("/").split("/")
        if path in ("/", "/index.html"):
            body = (BASE_DIR / "static" / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/config":
            self.send_json({"mock": MOCK, "interval_minutes": INTERVAL_MINUTES, "travel_mode": TRAVEL_MODE})
        elif path == "/api/routes":
            self.send_json(list_routes())
        elif len(parts) == 4 and parts[:2] == ["api", "routes"] and parts[3] == "samples":
            rid = self.route_id(parts)
            if not get_route(rid):
                return self.send_json({"error": "Route not found"}, 404)
            self.send_json(get_samples(rid))
        elif len(parts) == 4 and parts[:2] == ["api", "routes"] and parts[3] == "export.csv":
            rid = self.route_id(parts)
            route = get_route(rid)
            if not route:
                return self.send_json({"error": "Route not found"}, 404)
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["checked_at_utc", "origin", "destination", "eta_minutes",
                        "no_traffic_minutes", "distance_km", "error"])
            for s in get_samples(rid):
                w.writerow([
                    s["checked_at"], route["origin_address"], route["dest_address"],
                    round(s["duration_sec"] / 60, 1) if s["duration_sec"] is not None else "",
                    round(s["static_duration_sec"] / 60, 1) if s["static_duration_sec"] is not None else "",
                    round(s["distance_m"] / 1000, 2) if s["distance_m"] is not None else "",
                    s["error"] or "",
                ])
            body = buf.getvalue().encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/csv")
            self.send_header("Content-Disposition", f'attachment; filename="route_{rid}_eta.csv"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_POST(self):
        parts = urllib.parse.urlparse(self.path).path.strip("/").split("/")
        if parts == ["api", "routes"]:
            data = self.read_json()
            origin = (data.get("origin") or "").strip()
            destination = (data.get("destination") or "").strip()
            mode = (data.get("travel_mode") or TRAVEL_MODE).upper()
            if not origin or not destination:
                return self.send_json({"error": "Both places are required"}, 400)
            if mode not in ("DRIVE", "TWO_WHEELER", "WALK", "BICYCLE", "TRANSIT"):
                return self.send_json({"error": f"Unsupported travel mode {mode}"}, 400)
            try:
                self.send_json(create_route(origin, destination, mode), 201)
            except MapsError as e:
                self.send_json({"error": str(e)}, 502)
        elif len(parts) == 4 and parts[:2] == ["api", "routes"] and parts[3] in ("check", "toggle"):
            route = get_route(self.route_id(parts))
            if not route:
                return self.send_json({"error": "Route not found"}, 404)
            if parts[3] == "check":
                self.send_json(record_sample(route))
            else:
                with db_lock, db() as conn:
                    conn.execute("UPDATE routes SET active = 1 - active WHERE id = ?", (route["id"],))
                self.send_json(get_route(route["id"]))
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_DELETE(self):
        parts = urllib.parse.urlparse(self.path).path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["api", "routes"]:
            rid = self.route_id(parts)
            with db_lock, db() as conn:
                conn.execute("DELETE FROM samples WHERE route_id = ?", (rid,))
                conn.execute("DELETE FROM routes WHERE id = ?", (rid,))
            self.send_json({"deleted": rid})
        else:
            self.send_json({"error": "Not found"}, 404)


def main():
    init_db()
    threading.Thread(target=scheduler_loop, daemon=True).start()
    print(f"Travel ETA Tracker running on http://{HOST}:{PORT}")
    print(f"Checking every {INTERVAL_MINUTES:g} min | data: {DB_PATH}")
    if MOCK:
        print("MOCK MODE: no GOOGLE_MAPS_API_KEY set - travel times are simulated.")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
