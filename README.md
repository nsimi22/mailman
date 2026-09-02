# mailman

A self-hosted API client for your team. Postman without the bill.

- **Desktop app** (Windows, macOS, Linux) built with Electron.
- **Team server** (one Docker container) so everyone shares the same collections and environments, live.
- Works **offline** with a local workspace; switch to the team server whenever you want.
- **Imports your Postman collections and environments** (v2.0 / v2.1 exports) and exports them back.
- Variables (`{{baseUrl}}`), environments, folders, history, auth helpers (Bearer / Basic / API key), JSON, form-data, urlencoded and raw bodies, "copy as cURL".
- Zero paid services, zero accounts. A SQLite file on your server holds everything.

![mailman screenshot](docs/screenshot.png)

## How it fits together

```
 ┌────────────────────┐        ┌────────────────────┐
 │  mailman desktop   │        │  mailman desktop   │   ...each teammate
 │  (Electron)        │        │  (Electron)        │
 │  ┌──────────────┐  │        │  ┌──────────────┐  │
 │  │ local server │  │        │  │ local server │  │   embedded, for the
 │  │ + SQLite     │  │        │  │ + SQLite     │  │   "Local workspace"
 │  └──────────────┘  │        │  └──────────────┘  │
 └─────────┬──────────┘        └─────────┬──────────┘
           │  "Team server" mode proxies /api to →
           ▼                              ▼
       ┌──────────────────────────────────────────┐
       │  mailman team server (Docker)            │
       │  Express + SQLite, optional password     │
       │  also serves the web UI in a browser     │
       └──────────────────────────────────────────┘
```

The desktop app always talks to its own embedded server. In **Team server** mode that embedded server forwards API calls to the shared server and adds the team password, so credentials never live in the renderer and there is no CORS to configure.

The team server also serves the same UI in a browser, so people who don't want to install anything can just open `http://your-server:4000`.

## Quick start

### 1. Run the team server

```bash
git clone <this repo> && cd mailman
cp .env.example .env            # set MAILMAN_PASSWORD if the server is reachable beyond your LAN/VPN
docker compose up -d --build
```

The API and web UI are now on port 4000. Data lives in the `mailman-data` volume.

Without Docker:

```bash
npm install
npm run build                    # builds the web UI
MAILMAN_PASSWORD=changeme npm start
```

### 2. Run the desktop app

Development (hot reload for the UI):

```bash
npm install
npm run desktop:dev
```

Build installers for your platform (output in `desktop/release/`):

```bash
npm run desktop:dist             # dmg/zip on macOS, nsis/portable on Windows, AppImage/deb on Linux
```

Then in the app click **Local workspace** in the title bar → **Team server** → enter `http://your-server:4000` and the team password → **Test connection** → **Save & reload**.

### 3. Bring your Postman data over

In Postman: right-click a collection → **Export** (v2.1). Same for environments (gear icon → Export).
In mailman: **Collections → Import**, drop the file. Variables like `{{baseUrl}}` keep working.

## Configuration (server)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `MAILMAN_PASSWORD` | *(empty)* | Shared team password (HTTP Basic auth). Empty = no auth. |
| `MAILMAN_DB` | `./data/mailman.db` | SQLite file path |
| `MAILMAN_TIMEOUT_MS` | `30000` | Per-request timeout when sending |
| `MAILMAN_STATIC` | `./client/dist` | Directory of the built web UI |

The desktop app stores its settings and local database under the OS user-data directory (e.g. `~/Library/Application Support/mailman` on macOS).

## Security notes

- Requests are executed **by the server** (like Postman's cloud agent). Anyone who can reach the team server can make it call any URL it can reach, including internal services. Keep the server on your LAN/VPN or behind a reverse proxy with TLS, and set `MAILMAN_PASSWORD`.
- Environment values marked *secret* are masked in the editor but stored in plain text in SQLite, like Postman's local vault. Treat the database file accordingly.
- History keeps the last 500 requests (response bodies truncated) and is shared with the team.

## Project layout

```
server/   Express API + SQLite (node:sqlite, no native builds). Also serves the web UI.
client/   React + Vite UI (used by both the browser and the desktop app).
desktop/  Electron shell: embeds the server for the local workspace, proxies to the team server.
```

Scripts at the root:

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (port 4000) + Vite dev server (port 5173) for browser development |
| `npm run desktop:dev` | Same, plus the Electron window pointed at the dev server |
| `npm run build` | Build the web UI into `client/dist` |
| `npm start` | Run the server (serves the built UI) |
| `npm test` | Server unit + API tests |
| `npm run typecheck` | Type-check the client |
| `npm run desktop:pack` | Unpacked desktop build in `desktop/release/` (quick check) |
| `npm run desktop:dist` | Installers for the current platform |

Requires Node.js 22.13 or newer (for the built-in SQLite module).

## API

Everything the UI does goes through `/api`, so you can script it too:

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/collections` | Collections with their folders and requests |
| POST/PATCH/DELETE | `/api/collections[/:id]` | |
| GET | `/api/collections/:id/export` | Postman v2.1 JSON |
| POST/PATCH/DELETE | `/api/folders[/:id]` | |
| GET/POST/PATCH/DELETE | `/api/requests[/:id]` | |
| GET/POST/PATCH/DELETE | `/api/environments[/:id]` | |
| GET | `/api/environments/:id/export` | Postman environment JSON |
| POST | `/api/import` | Body: a Postman collection or environment export |
| POST | `/api/send` | `{ request, environmentId }` → executes and returns the response |
| POST | `/api/curl` | Same input, returns a cURL command |
| GET/DELETE | `/api/history[/:id]` | |

## Roadmap ideas

Pre-request / test scripts, per-user accounts, request-level docs pages, WebSocket/GraphQL helpers, collection runner. PRs welcome.

## License

MIT
