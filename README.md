# printmax

Self-hosted web app for a homelab or small office: upload a PDF, PNG or JPEG, pick a printer and
options, print. Talks IPP directly to the printer, so there is no CUPS to run or babysit.

Status: **milestone M1 (walking skeleton)**. Add a printer by URI, discover its capabilities, upload
a document, submit it with options validated against those capabilities, and follow the job to
completion. No users, presets or discovery yet. See `print-server-plan.md` for the design and
the roadmap.

## Run

```sh
docker compose up -d
```

Then open <http://localhost:8080>, add a printer with its IPP URI (usually
`ipp://<host>/ipp/print`; run `ippfind` on a machine on the printer's network if unsure) and print.

Environment:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/data` in the container | SQLite database and uploads |
| `RETENTION_DAYS` | `7` | Delete uploaded files this long after the job finishes |
| `POLL_INTERVAL_MS` | `3000` | How often job state is polled and retries are attempted |
| `MAX_UPLOAD_MB` | `200` | Upload size limit |

Job submission retries with exponential backoff (5 attempts) when the printer cannot be reached.
Rejections from the printer fail the job immediately with the IPP status and message.

The container runs as the unprivileged `node` user (uid 1000). The named volumes in `compose.yaml`
inherit the right ownership; if you bind-mount a host directory instead, `chown 1000:1000` it first.

Printer credentials (for devices that require HTTP basic auth on IPP) are stored unencrypted in
the SQLite database. Treat the data volume accordingly.

## Develop

```sh
pnpm install
pnpm test          # unit tests plus an end-to-end run against ippeveprinter if installed
pnpm dev           # API on :8080 (serves dist/client if built)
pnpm dev:client    # Vite dev server with /api proxied to :8080
```

Capture a printer's attributes as a fixture:

```sh
pnpm dump-caps ipp://printer/ipp/print > fixtures/my-printer.json
```

## Layout

- `src/server/ipp/` — RFC 8010 codec, HTTP transport, operations, option typing and validation
- `src/server/` — SQLite (`node:sqlite`), printers, jobs, worker, Fastify app
- `src/client/` — React front end, served static by the server in production
- `fixtures/` — verbatim Get-Printer-Attributes dumps used as test data

## Deviations from the plan

- `ipp` npm package replaced by an in-house codec: the package was last published in 2022 and
  declares `engines.node < 4`. The codec is ~400 lines and round-trip tested.
- `better-sqlite3` replaced by Node's built-in `node:sqlite` (release candidate in Node 24, no
  flag): same synchronous API, no native build in the Docker image.
- Printers carry optional `username`/`password` columns; the target device advertises "IPP 2.0
  with authentication".
