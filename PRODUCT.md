# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Reside Church staff and volunteers** (primary). Non-technical people at the church office printing from their own laptops or phones, occasionally, often in a hurry before a service or meeting. They have never installed a printer driver and should not need to.
- **Bevan as administrator.** Sets up printers, presets and users; wants dense, fast control surfaces and clear diagnostics when a printer misbehaves.
- **Other organisations later.** Intended to be reusable beyond Reside, so nothing in the product is organisation-specific.

## Product Purpose

printmax lets ordinary users upload a PDF, PNG or JPEG, pick a printer and a named preset, and print, from any device on the network with no drivers. Admins publish presets so the right settings (duplex, tray, colour, finishing) are one choice rather than twelve. Success for a first-time user is printing in under a minute without being shown how.

## Positioning

Talks IPP directly to the printer with no CUPS spooler in the path, and generates its entire option editor and validation from the printer's own `Get-Printer-Attributes` response. The only hand-maintained table is labels and widget types. Constraint and resolver data published by the printer (PWG 5100.13) is honoured, so invalid combinations are caught before a job is sent and the printer's own suggested fix is offered.

## Operating Context

- Runs self-hosted in Docker on a LAN (homelab or an office server), reached over a browser, sometimes through a reverse proxy or tunnel.
- Primary target printer: a Toshiba e-STUDIO 3515AC multifunction device at Reside. Its capabilities (finishers, department codes) are not yet confirmed; see `print-server-plan.md` section 7.
- Printing is occasional and interruptive: someone has a document and needs paper now. Admin work is rare and deliberate.
- Users often arrive on a phone over the office Wi-Fi; the print flow must work one-handed on a small screen.

## Capabilities and Constraints

- Supported formats: PDF, PNG, JPEG only. Office documents are a deferred v2 feature.
- Entities: printers, presets (shared or personal), jobs, users (admin or user), capability overrides, capability change records.
- Job states are the printer's own IPP states plus local `queued`, `retrying`, `failed`, `unknown`. Printer state and state reasons come verbatim from the device.
- Local accounts only. First visit creates the admin.
- Runtime assets must be fully self-hosted: no web fonts, CDNs or external requests at runtime, so it works on an isolated LAN.
- Terminology: "preset" (a named set of print options), "printer", "job", "capabilities" (what the printer reports it can do), "overrides" (admin corrections to under-reported capabilities).
- Undecided: repository visibility and licence; whether authentication will later hook into an existing directory.

## Brand Commitments

- Name: **printmax**, lowercase.
- Neutral product identity. No organisation branding baked in.
- No logo or visual assets exist yet.
- **Standing visual preference (Bevan, 3 Sep 2026):** the category standard for product UI, played straight, at the craft level of Linear. Dense, fast, neutral greys with one accent, crisp tables, precise type. No novelty metaphors.

## Evidence on Hand

- `fixtures/ippeveprinter.json`: a real Get-Printer-Attributes dump from CUPS' sample IPP Everywhere printer; the source of truth for what option editors and validation see.
- No dump from the Toshiba yet. Do not invent its capabilities, finishers or accounting behaviour.
- No user testimonials, screenshots of competing products, or usage data.

## Product Principles

1. **The printer is the authority.** Every option, choice and default comes from the device; the UI never claims a capability the printer did not report, and never hides an IPP state, reason or error.
2. **Presets carry the decisions.** The default path is printer, preset, file, print. The full option set is one click away, never in the way.
3. **Density for admins, brevity for everyone else.** Admin surfaces favour scanability and diagnostics over decoration; user surfaces favour the fewest steps.
4. **Nothing needs a manual.** If a volunteer would need to be shown a screen once, the screen is wrong.
5. **Honest state, always.** Retries, failures and printer messages are shown plainly with the printer's own words.

## Accessibility & Inclusion

Keyboard-operable forms and visible focus throughout. Colour never carries state alone; job and printer states are always labelled in words. Touch targets sized for one-handed phone use in the print flow.
