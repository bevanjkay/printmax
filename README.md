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
- **No spooler.** Jobs retry with backoff when the printer is unreachable, and wait it out when it
  says it is busy with another job; real rejections surface the printer's own IPP status and message.

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
| `MAX_POSTSCRIPT_MB` | `512` | Ceiling on the PostScript one conversion may produce; image-heavy pages cost a few MB each, whatever the PDF weighed |
| `STORED_DIR` | `/data/stored` | Library documents, kept until deleted |
| `SETUP_TOKEN` | generated | Required by the first-run setup page; a random one is printed in the log when unset |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-*` from a reverse proxy; set `false` when clients reach the app directly, or a CIDR list |

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

The app ignores `X-Forwarded-*` headers by default. Behind Caddy, Traefik, nginx or a Cloudflare
Tunnel, set `TRUST_PROXY` to the proxy IP or CIDR (a comma-separated list is accepted), and prevent
clients from reaching the backend directly. Only use `true` when every path to the backend passes
through a proxy that sanitizes forwarded headers. Trusted HTTPS requests receive a `Secure` session cookie. Two
things to check on the proxy: allow request bodies up to `MAX_UPLOAD_MB` (nginx:
`client_max_body_size`), and forward `X-Forwarded-Proto`. Nothing in the app needs a path prefix
or WebSockets.

### Security notes

- Every printing, preset and printer route needs a signed-in session; sessions are random tokens
  stored hashed, `HttpOnly`, `SameSite=Lax`, and `Secure` behind HTTPS.
- Sign-in and setup are rate limited to 10 attempts per client IP per minute (from
  trusted `X-Forwarded-For` when `TRUST_PROXY` is configured).
- The first-run setup page needs the token printed in the log at startup, so an instance exposed
  before its admin exists cannot be claimed by a passer-by.
- Responses carry a self-only Content Security Policy and the usual Helmet headers; the app loads
  nothing from outside itself.
- For internet exposure an identity-aware proxy (Cloudflare Access or similar) in front of the
  sign-in page is still the strongest cheap control.

- Sessions are random tokens stored server-side; nothing to configure and no signing secret.
- Passwords are hashed with scrypt.
- Printer credentials (for devices that require HTTP basic auth on IPP) are stored unencrypted in
  the SQLite database. Treat the data volume accordingly.
- IPPS connections verify certificates; private certificates need an explicitly configured trust root.

### Printer TLS and conversion limits

IPPS/HTTPS printer connections verify the certificate and hostname. For a private CA or self-signed
printer certificate, mount the trusted PEM certificate read-only and set `NODE_EXTRA_CA_CERTS` to
its container path (for example `/certs/printer-ca.pem`) in the service environment, then restart.
Obtain that certificate through a trusted channel; its subject alternative name must match the
printer URI. Existing self-signed IPPS printers need this configuration after upgrading.

PostScript mode invokes Ghostscript's PDF interpreter directly and stops conversion after 60 seconds
or 64 MiB of generated output. Cancellation terminates an active conversion. These bounds are separate
from the upload size limit. Temporary upload files abandoned by a crash are removed after 24 hours;
in-flight uploads are excluded.

Shared library entries follow only shared presets. Selecting a personal preset when saving a shared
entry saves a snapshot. If a linked preset becomes private or moves to another printer, the entry
uses its previously saved snapshot and stops exposing the live preset's name and settings.

## Develop

The TLS regression test uses the `openssl` CLI. Printer and conversion tests also use
`ippeveprinter` and `gs` when installed.

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

## PostScript mode (folding, booklets and other driver-only finishing)

Some finishing never appears in a printer's IPP attributes because the vendor implements it as
private PostScript commands in its driver; on the Toshiba e-STUDIO that covers folding,
saddle stitch and booklet imposition. printmax can send jobs the way that driver does. Under
Printers, upload the device's PPD (on a Mac with the printer installed it is in `/etc/cups/ppd/`)
and switch the printer to **PostScript via PPD**. From then on:

- the print form and presets use the PPD's own options (`ppd:<Key>` in the option map) plus
  copies, in place of the IPP attributes;
- each job is a PDF converted with Ghostscript and wrapped in the PPD's PJL header with every
  option's snippet in `*OrderDependency` order, exactly as CUPS emits it;
- PDF is the only accepted upload while the mode is on;
- pages go out edge to edge, so the only clipping is the printer's own unprintable strip. Turn on
  **Keep printer margins** (per job or in a preset) to shrink each page uniformly into the PPD's
  imageable area instead, the way the vendor driver does.

It is opt-in per printer and reversible; plain IPP remains the default. The proof for the
Toshiba was an 8-page A5 booklet that came out imposed and folded (`fixtures/booklet-8-pages.pdf`).

## Library

The Library keeps documents for good, each paired with a preset: the weekly bulletin, the giving
envelope, the welcome card. Printing one is a click plus a copies count. Entries can be shared
with everyone (admins) or personal, like presets, and any job whose file is still on the server
can be kept from the Jobs list with **Keep**. Files live under `/data/stored` and are never swept
by retention; the preset is followed by reference, so improving it improves every document that
uses it.

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
