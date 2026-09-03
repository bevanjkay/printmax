# Print server manager — implementation plan

**Status:** M1, M2 and M3 built 3 Sep 2026 (see README for what shipped). **M0 is still open:** the Toshiba is
only reachable from Reside's LAN, so the `ipptool` spike and the department-code question are
unresolved. Development so far targets `ippeveprinter`; `fixtures/ippeveprinter.json` stands in for the
Toshiba dump until M0 is run on-site.
**For:** anyone continuing the build. This doc is self-contained; you do not need the conversation
that produced it.

---

## 1. What we're building

A self-hosted, Docker-deployed web app for a Linux server / homelab that lets ordinary
(non-admin) users **upload a document, pick a shared named preset, and print it** to a
network printer. Multi-user, with presets shared across users.

The gap it fills: CUPS's own web UI manages printers and jobs but has no document upload and
no non-admin user model. SavaPage (AGPLv3) does roughly all of this but is enterprise-shaped,
Java + PostgreSQL, has no first-party Docker image, and carries a lot of machinery we don't
want. Everything else in the space is a toy.

**Primary target device:** Toshiba e-STUDIO 3515AC at Reside. See §7 — it constrains the design
and there is one blocking question to answer before building.

## 2. Non-goals for v1

Say no to these explicitly; each one is a rabbit hole:

- Office-format conversion (docx/xlsx/pptx). **v1 is PDF, PNG, JPEG only.** Conversion means
  headless LibreOffice in the image — large, slow, imperfect fidelity, and the single biggest
  future support burden. Defer to v2 as an optional sidecar.
- Accounting, quotas, pay-per-print, chargeback.
- Secure/pull printing with badge release.
- Scanning. This is a print server, not an MFP console.
- Mobile apps. Responsive web only.

## 3. Architecture

**Talk IPP directly to the printer. Do not put CUPS in the main path.**

This is the key call. CUPS 3.0 removes PPD and driver support entirely (drivers move behind
IPP as PAPPL "Printer Applications"), and the target printer speaks PostScript 3 and PDF
natively — so there is nothing for CUPS to render. Going direct means no spooler to babysit,
no port 631 collision, no mDNS-across-Docker-bridge problem for the print path, and no
rewrite when CUPS 3 lands.

```
┌─────────────────┐     IPP      ┌──────────────┐
│  app container  │─────────────▶│   printer    │
│  Node + SQLite  │              └──────────────┘
│  + file storage │     IPP      ┌──────────────────────────┐
│                 │─────────────▶│ Printer Application      │  (only if a legacy,
└─────────────────┘              │ sidecar (PAPPL)          │   non-IPP printer
                                 └──────────────────────────┘   ever needs supporting)
```

Legacy printers get a Printer Application sidecar (`ps-printer-app`, `gutenprint-printer-app`,
`hplip-printer-app`, or the pappl-retrofit Legacy Printer Application) which re-exposes them as
IPP. **One code path either way** — the app only ever speaks IPP.

Trade-off accepted: we give up CUPS's queueing/retry, so implement job retry ourselves (§6).

**Stack** (repo convention is Node-first; deviate only with a stated reason):

- Node + TypeScript, Fastify
- SQLite via `better-sqlite3` — single-file, trivially backed up, right size for this
- `ipp` npm package for the IPP client; `ipptool`/`ippfind` from `cups-ipp-utils` in the image
  for debugging
- React + Vite front end, served static from Fastify
- Uploaded files on a mounted volume, not in the DB
- Single container. `docker compose` with one service and two volumes (data, uploads)

## 4. Data model

```
users        id, email, name, password_hash, role (admin|user), created_at

printers     id, name, uri, uuid, make_model, location,
             caps_discovered JSON, caps_overrides JSON, caps_fetched_at

presets      id, printer_id, name, description, scope (global|user), owner_id NULL,
             options JSON, created_at, updated_at

jobs         id, user_id, printer_id, preset_id, filename, file_path, byte_size,
             options_final JSON, ipp_job_id, state, state_reasons JSON,
             created_at, submitted_at, completed_at
```

`options` is a flat **IPP attribute → value map**, e.g.
`{"sides":"two-sided-long-edge","media":"iso_a4_210x297mm","print-color-mode":"monochrome"}`.

Presets, per-job overrides and the final submitted set are all this same shape. That makes
validation one function called three times (on preset save, on job build, before submit).
Do not invent a friendlier intermediate schema — it will drift from the spec and cost you.

## 5. Capability discovery — the core mechanic

**Never hand-maintain a printer feature table.** The printer tells you its own feature set.

**Find:** mDNS/DNS-SD browse for `_ipp._tcp` and `_ipps._tcp` (note `_pdl-datastream._tcp` and
`_printer._tcp` as legacy). TXT keys give a pre-flight summary: `ty` (make/model), `rp`
(resource path), `pdl`, `Color`, `Duplex`, `URF`, `note` (location), `UUID`. **Also accept a
manually entered URI** — mDNS will not cross the Docker bridge or a VLAN, so manual entry is
the reliable path and discovery is the convenience.

**Interrogate:** one `Get-Printer-Attributes` operation. Request `all`, **plus explicitly name
`media-col-database`** — it is excluded from `all` and won't come back otherwise.

Store the whole response verbatim in `caps_discovered`. Attributes that matter:

| Group | Attributes |
|---|---|
| Identity | `printer-make-and-model`, `printer-uuid`, `printer-location`, `printer-device-id`, `printer-uri-supported`, `uri-authentication-supported` |
| Formats | `document-format-supported`, `urf-supported`, `pwg-raster-document-*` |
| Options | `media-supported`, `media-col-database`, `media-source-supported`, `media-type-supported`, `sides-supported`, `print-color-mode-supported`, `print-quality-supported`, `printer-resolution-supported`, `finishings-supported`, `finishings-col-database`, `output-bin-supported`, `copies-supported`, `number-up-supported`, `page-ranges-supported`, `multiple-document-handling-supported`, `print-scaling-supported` |
| Auth/accounting | `job-password-supported`, `job-account-id-supported`, `job-accounting-user-id-supported`, `job-hold-until-supported` |
| Gatekeeping | `job-creation-attributes-supported`, `job-constraints-supported`, `job-resolvers-supported`, and a `*-default` for every option |

**Generate the preset editor from the response:**

1. Iterate `job-creation-attributes-supported` — that is your form's field list.
2. For each entry, choices come from `<attr>-supported`, initial value from `<attr>-default`.
3. Keep one small **static** map of attribute name → human label + widget type (`sides` →
   "Duplex", radio; `finishings` → "Finishing", multi-select). ~25 rows, printer-independent.
   This is the only thing maintained by hand.

**Validate** against `job-constraints-supported` / `job-resolvers-supported` (PWG 5100.13, the
successor to PPD UIConstraints). Resolvers tell you what to change to make an invalid
combination valid — good UX if you want it. Many devices publish no constraints at all; where
absent, accept that some jobs fail at the device and surface `job-state-reasons` honestly.

**Printers under-report.** Optional hardware is the worst case: a stapler can be physically
fitted while `finishings-supported` returns only `3` (none). Hence the two-layer model —
`caps_discovered` (fetched) merged with `caps_overrides` (admin-edited) at read time. Re-fetch
on demand and on a schedule, **diff against the previous fetch, and flag changes** rather than
silently breaking existing presets.

## 6. Job lifecycle

1. Upload → validate MIME against `document-format-supported` → store on volume
2. User picks printer + preset, optionally overrides fields → build `options_final`
3. Validate against cached caps + constraints; reject with a readable message
4. Submit via IPP `Print-Job` (or `Create-Job` + `Send-Document` for larger files)
5. Persist returned `ipp_job_id`; poll `Get-Job-Attributes` for `job-state` and
   `job-state-reasons`; surface both in the UI
6. Retry on transport failure with backoff (we own this — no CUPS spooler underneath)
7. Delete the uploaded file on a retention timer (make it configurable; default 7 days)

## 7. Target device: Toshiba e-STUDIO 3515AC

Verified from the manufacturer spec sheet:

- **PDLs: PCL5e, PCL5c, PCL6, PS3, PDF, XPS, JPEG.** Native PostScript and PDF — nothing to
  rasterise, which is why direct IPP works.
- **Printing protocols: IPP 2.0 with authentication**, SMB, LPR/LPD, port 9100, WS Print, FTP
- AirPrint and Mopria certified
- Duplex standard. Finishers are all **optional**: Inner Finisher MJ1042B, 50-sheet Staple
  MJ1109B, Saddle-Stitch MJ1110B, punch units MJ6011/MJ6105, Job Separator MJ5015.
  **Confirm which is actually fitted at Reside** before designing preset UI around stapling.
- Account control: up to 10,000 users / 1,000 departments

### ⚠ Blocking question — resolve before writing code

**Toshiba documents that AirPrint cannot be used on equipment with the department code
function enabled.** If Reside has department codes on for cost allocation, the driverless path
may be closed and the whole architecture in §3 is in question.

Possible escape hatch: check whether the firmware advertises **`job-account-id-supported`**.
That is the standard IPP job-template attribute for exactly this (PWG 5100.7; see also PWG
5199.11 *Job Accounting with IPP*). If present, department codes may be expressible over plain
IPP and the problem dissolves.

### First command to run — settles §5 and §7 at once

```sh
ipptool -tv ipp://<printer-ip>/ipp/print get-printer-attributes.test | grep -- -supported
```

Read: `document-format-supported`, `finishings-supported`, `media-source-supported`,
`output-bin-supported`, `sides-supported`, `print-color-mode-supported`,
`job-creation-attributes-supported`, `job-constraints-supported`, `job-password-supported`,
and above all **`job-account-id-supported`**.

Whatever is in those lists *is* the feature set the app can offer. Paste the full dump into the
repo as a fixture — it doubles as the test data for the preset-editor generator.

## 8. Milestones

- **M0 — Spike (half a day).** Run the command above from the Docker host. Confirm reachability,
  capture the attribute dump, answer the department-code question. **Do not proceed until this
  is done** — it is binary, and it decides whether the design holds.
- **M1 — Walking skeleton.** Add printer by URI, fetch and store caps, upload a PDF, submit with
  hardcoded options, poll state. No auth, no presets, no UI polish.
- **M2 — Presets + users.** Generated preset editor from `job-creation-attributes-supported`,
  constraint validation, global vs personal presets, login, job history.
- **M3 — Ship.** mDNS discovery, admin caps overrides + re-fetch/diff, retention timer,
  `docker compose` + README, reverse proxy notes.
- **v2 (deferred).** LibreOffice conversion sidecar, page preview, N-up, legacy printers via a
  Printer Application sidecar.

## 9. Open decisions for Bevan

1. **Is this a rebuild of the dead Reside print stack?** `HANDOFF.md` records
   `print.gcio.org.au` returning 530 — Portainer stack 35, tunnel deleted 11 Aug, written
   config lost. If that stack was a CUPS container, this project supersedes it and the two
   should be scoped as one job rather than two.
2. **Where does it run** — the Docker host at `192.168.86.199`, or Reside's own Portainer?
   Determines network reachability to the printer and who the users are.
3. **Auth model** — local accounts, or hook into something existing? v1 assumes local.
4. **Public or private repo**, and is this intended for release? Affects licence choice and how
   much the README carries.

## 10. References

- [PWG 5100.13 — IPP Driver Replacement Extensions (2023)](https://ftp.pwg.org/pub/pwg/candidates/cs-ippnodriver20-20230301-5100.13.pdf) — job constraints/resolvers
- [PWG 5100.7 — IPP Job Extensions](https://ftp.pwg.org/pub/pwg/candidates/cs-ippjobext20-20190816-5100.7.pdf) — `job-account-id`
- [PWG 5100.14 — IPP Everywhere](https://ftp.pwg.org/pub/pwg/candidates/cs-ippeve11-20200515-5100.14.pdf)
- [PWG 5199.11 — Job Accounting with IPP](https://ftp.pwg.org/pub/pwg/informational/bp-ippaccounting10-20210205-5199.11.pdf)
- [IANA IPP Registrations](https://www.iana.org/assignments/ipp-registrations/ipp-registrations.xml) — authoritative attribute list
- [OpenPrinting: Printer Applications and Printer Drivers](https://openprinting.github.io/cups/drivers.html)
- [Toshiba e-STUDIO 3515AC spec sheet](https://business.toshiba.com/media/tabs/downloads/product/mfp/2515AC-3015AC-3515AC%20Spec%20Sheet.pdf)
- [SavaPage](https://www.savapage.org/) — prior art, evaluate before building if scope creeps
