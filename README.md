# printmax

Self-hosted web app for a homelab or small office: upload a PDF, PNG or JPEG, pick a printer and
a preset, print. Talks IPP directly to the printer, so there is no CUPS to run or babysit.

- **Capability-driven.** The printer's own `Get-Printer-Attributes` response generates the option
  editor, validates every job, and is diffed on each re-fetch so changes are flagged instead of
  silently breaking presets. The only hand-maintained table is labels and widget types.
- **Shared presets.** Admins publish named presets for everyone; users keep personal ones.
  Constraint and resolver data (PWG 5100.13) is honoured when the printer publishes it, with a
  one-click "apply suggested fix".
- **Multi-user.** Local accounts, admin and user roles, per-user job history.
- **No spooler.** Jobs retry with backoff when the printer is unreachable; rejections surface the
  printer's own IPP status and message.

Status: milestones M1 to M3 of `print-server-plan.md` are built. M0 (the spike against the office
Toshiba e-STUDIO) has its capabilities captured as a fixture and Validate-Job checked; a real print
run is still to be done on-site. Development targets `ippeveprinter`.

## Run

The standard install is Docker Compose with [docker-compose.yml](./docker-compose.yml), which
pulls `ghcr.io/bevanjkay/printmax:latest` (built by CI from `main`; releases are tagged `vX.Y.Z`):

```sh
docker compose up -d
```

To build and run from source instead, add the development override:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Open <http://localhost:8080>. The first visit asks you to create the admin account. Then, under
Printers, add a printer by IPP URI (usually `ipp://<host>/ipp/print`) or scan for one.

Every variable has a default; set them in the environment or a `.env` file next to the compose file.

| Variable | Default | Purpose |
|---|---|---|
| `PRINTMAX_IMAGE` | `ghcr.io/bevanjkay/printmax:latest` | Image the compose file runs |
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/data` in the container | SQLite database and uploads |
| `RETENTION_DAYS` | `7` | Delete uploaded files this long after the job finishes |
| `POLL_INTERVAL_MS` | `3000` | How often job state is polled and retries are attempted |
| `CAPS_REFRESH_HOURS` | `24` | Re-fetch printer capabilities older than this; `0` disables |
| `DISCOVERY_TIMEOUT_MS` | `3000` | How long a network scan listens for DNS-SD answers |
| `MAX_UPLOAD_MB` | `200` | Upload size limit |

The app runs as the unprivileged `node` user (uid 1000). The container starts as root only to
hand `/data` to that user, so a bind-mounted host directory or a volume created by an older image
works without preparation. If you start it with `--user` instead, the ownership step is skipped
and `/data` must already be writable by that uid; the server says so plainly and exits if not.

### Network discovery

"Scan" browses DNS-SD (`_ipp._tcp` / `_ipps._tcp`). Multicast does not cross the Docker bridge,
so inside Docker it only works with `network_mode: host` (see the commented block in
`docker-compose.yml`). Manual URI entry is the reliable path; `ippfind` on any machine on the printer's
network prints the URI.

### Reverse proxy

The app trusts `X-Forwarded-*` headers and marks the session cookie `Secure` when the request
arrived over HTTPS, so put it behind Caddy, Traefik, nginx or a Cloudflare Tunnel as usual. Two
things to check on the proxy: allow request bodies up to `MAX_UPLOAD_MB` (nginx:
`client_max_body_size`), and forward `X-Forwarded-Proto`. Nothing in the app needs a path prefix
or WebSockets.

### Security notes

- Sessions are random tokens stored server-side; nothing to configure and no signing secret.
- Passwords are hashed with scrypt.
- Printer credentials (for devices that require HTTP basic auth on IPP) are stored unencrypted in
  the SQLite database. Treat the data volume accordingly.
- IPPS connections accept self-signed printer certificates.

## Develop

```sh
pnpm install
pnpm test          # unit and API tests, plus an end-to-end run against ippeveprinter if installed
pnpm dev           # API on :8080 (serves dist/client if built)
pnpm dev:client    # Vite dev server with /api proxied to :8080
```

Capture a printer's attributes as a fixture:

```sh
pnpm dump-caps ipp://printer/ipp/print [username password] > fixtures/my-printer.json
```

## Preset files

The Presets page exports a printer's presets as JSON and imports the same format; presets whose
options the printer rejects are listed rather than failing the whole file. A separate converter,
`batchoutput-export`, turns Zevrix BatchOutput PDF presets into these files, one per preset; it
keeps what a printer takes over IPP (paper size, tray, paper type, duplex, colour, corner staples,
orientation, copies) and records the rest in each preset's description.

The preset editor's "Check with printer" button sends the options as an IPP Validate-Job, so the
device itself confirms it would accept them without printing anything. The capability overrides
editor suggests registered IANA/PWG values the printer did not report; use the same check to
confirm a value before relying on it. A rejection is reliable; a pass is only as good as the
device's own checking (the Toshiba e-STUDIO accepts any job attribute and only validates the
document format).

## Layout

- `src/server/ipp/` — RFC 8010 codec, HTTP transport, operations, option typing and validation,
  constraint/resolver evaluation
- `src/server/` — SQLite (`node:sqlite`), auth and sessions, printers, presets, jobs, worker,
  capability diffing, DNS-SD discovery, Fastify app
- `src/shared/` — DTOs, IPP enum tables, and the attribute label/widget table
- `src/client/` — React front end, served static by the server in production
- `fixtures/` — verbatim Get-Printer-Attributes dumps used as test data

## Deviations from the plan

- `ipp` npm package replaced by an in-house codec: the package was last published in 2022 and
  declares `engines.node < 4`. The codec is ~400 lines and round-trip tested.
- `better-sqlite3` replaced by Node's built-in `node:sqlite` (release candidate in Node 24, no
  flag): same synchronous API, no native build in the Docker image.
- Printers carry optional `username`/`password` columns; the target device advertises "IPP 2.0
  with authentication".
- A `sessions` table and a `caps_changes` table were added for login and re-fetch diffing.
