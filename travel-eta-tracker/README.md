# Travel ETA Tracker

A small app that runs on your own computer. It:

1. Asks for two places, **From** and **To**, typed the way you would in Google Maps.
2. Looks both places up with the **Google Geocoding API**.
3. Shows the **live, traffic-aware travel time**, from the **Google Routes API**.
4. **Checks the ETA again every hour** (at the top of the hour) for every tracked route and saves each check in a local SQLite database.
5. Shows the history as a chart and a table, and lets you download it as CSV for Excel.

It needs only Python 3.8 or newer. There is nothing to `pip install`.

---

## Step 1: Get a Google Maps API key (one time, about 10 minutes)

1. Open <https://console.cloud.google.com/> and sign in.
2. Go to the project drop-down at the top, click **New Project**, give it a name (for example `eta-tracker`), and click **Create**.
3. Go to **Billing** and link a billing account. Google requires one, but the free monthly credit covers personal use: hourly checks on a few routes are about 750 calls a month.
4. Go to **APIs & Services → Library**. Find and **Enable** both of these:
   - **Geocoding API**
   - **Routes API**
5. Go to **APIs & Services → Credentials**, click **Create credentials → API key**, and copy the key.
6. Recommended: click the key, then under **API restrictions** choose *Restrict key* and tick only *Geocoding API* and *Routes API*. Click **Save**.

> **Workaround, if Routes API is not in the Library list:** some older projects only show the
> *Distance Matrix API*. Create a new project as in step 2. New projects always offer the
> Routes API.
>
> **Workaround, if you can't add billing right now:** you can still run the app in **mock mode**
> (see Step 3) to try the screens and the hourly collection with simulated travel times.

## Step 2: Install Python (skip if `python3 --version` already works)

- **Windows:** install Python from <https://www.python.org/downloads/>. On the first installer screen, tick **"Add python.exe to PATH"**.
- **macOS:** `brew install python`, or use the installer from python.org.
- **Linux:** usually already installed. If not, run `sudo apt install python3`.

## Step 3: Configure and start

```bash
cd travel-eta-tracker
cp .env.example .env          # Windows: copy .env.example .env
# open .env in any editor and paste your key after GOOGLE_MAPS_API_KEY=
```

Start the app:

| OS | Command |
|----|---------|
| Windows | double-click `start.bat` (or run `python app.py`) |
| macOS / Linux | `./start.sh` (or `python3 app.py`) |

Open **http://localhost:8080** in your browser.

If no key is set, the app starts in **mock mode** with simulated numbers and a yellow banner at the top of the page.

## Step 4: Use it

1. Type the **From** and **To** places, for example `Hinjewadi Phase 1, Pune` and `Pune Airport`. You can also type `lat,lng` coordinates.
2. Choose a mode (Car, Two-wheeler, Transit, Bicycle or Walk) and click **Get travel time**.
3. The card shows the current ETA, the distance, and the delay caused by traffic.
4. Leave the app running. It adds a new sample every hour. The page updates itself every 5 minutes.
5. On a route card you can:
   - **Check now**: take an extra sample right away.
   - **Pause / Resume tracking**: stop or restart the hourly checks for that route.
   - **Download CSV**: save the full history for Excel.
   - **Delete**: remove the route and its history.

All data is stored in `eta_data.sqlite3` next to `app.py`. It is kept across restarts.

---

## Keeping it collecting 24×7

The app only collects data while it is running. If you close the terminal or the PC goes to sleep, collection stops. Pick the option for your OS:

**Windows: Task Scheduler**
1. Open *Task Scheduler* and click **Create Task**.
2. On the **General** tab, choose *Run whether user is logged on or not*.
3. On the **Triggers** tab, add *At startup*.
4. On the **Actions** tab, set *Start a program* to `C:\path\to\travel-eta-tracker\start.bat`.
5. On the **Conditions** tab, untick *Start only if on AC power*.
6. In Power settings, set **Sleep = Never**. Otherwise no samples are taken while the PC sleeps.

**macOS / Linux: run in the background**
```bash
nohup python3 app.py > tracker.log 2>&1 &
```
To start it automatically when you log in on Linux, add this line with `crontab -e`:
```
@reboot cd /path/to/travel-eta-tracker && /usr/bin/python3 app.py >> tracker.log 2>&1
```

> **Workaround if the laptop can't stay on:** run the app on any always-on machine, such as a
> Raspberry Pi, an office desktop or a small cloud VM. Set `HOST=0.0.0.0` in `.env` and open
> `http://<that-machine-ip>:8080` from your own device.

## Settings (`.env`)

| Variable | Default | Meaning |
|----------|---------|---------|
| `GOOGLE_MAPS_API_KEY` | (empty) | Your key. If empty, the app runs in mock mode. |
| `CHECK_INTERVAL_MINUTES` | `60` | How often to collect samples. Checks are aligned to clock boundaries. |
| `TRAVEL_MODE` | `DRIVE` | Default mode for API calls (the UI lets you choose per route). |
| `PORT` | `8080` | Web port. |
| `HOST` | `127.0.0.1` | Set to `0.0.0.0` to allow access from other devices on your network. |
| `MOCK_MODE` | off | Set to `1` to force simulated data. |
| `DB_PATH` | `./eta_data.sqlite3` | Where samples are stored. |

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `HTTP 403: ... Routes API has not been used in project ...` | The Routes API is not enabled yet. Do Step 1.4, then wait 2–5 minutes. |
| `HTTP 403: API key not valid` / `REQUEST_DENIED` | The key is wrong or restricted to other APIs. Recheck Step 1.6. |
| `Google Maps could not find '...'` | The place name is too vague. Add the city or state, or type `lat,lng`. |
| `No route found` | No route exists for that mode (for example Transit in an area with no transit data). Try Car. |
| `Address already in use` | Port 8080 is busy. Set `PORT=8090` in `.env`. |
| Chart missing, only the table shows | The browser can't reach `cdnjs.cloudflare.com`, which hosts the Chart.js library. The data and CSV still work. |
| Gaps in the hourly log | The PC was asleep or the app was closed. See "Keeping it collecting 24×7". |

## How it works

- `app.py` is a standard-library HTTP server, a SQLite store and a background thread. The thread wakes at each interval boundary and calls the Routes API `computeRoutes` with `TRAFFIC_AWARE_OPTIMAL` routing for every active route.
- `duration` is the ETA with current traffic. `staticDuration` is the ETA with no traffic. The gap between them is shown as the traffic delay.
- `static/index.html` is the UI: the form, route cards, the Chart.js line chart and the log table.
