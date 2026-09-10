# printmax — agent notes

- Read `print-server-plan.md` first. It is the design; milestones and non-goals are decided.
- The app speaks IPP directly (`src/server/ipp/`). Do not add CUPS to the print path.
- Job options are a flat `{ "ipp-attribute": value }` map everywhere (presets, overrides, `options_final`). Do not invent a friendlier schema.
- Value typing and validation live in `src/server/ipp/options.ts` and are driven by the printer's own `*-supported`/`*-default` attributes. Only `KNOWN_TYPES` and `ipp/enums.ts` are hand-maintained.
- PostScript mode (`src/server/ppd/`) is opt-in per printer: the PPD's options live in the same flat option map as `ppd:<Key>`, validation switches on `PrinterProfile.mode`, and the job is Ghostscript output wrapped in the PPD's JCL with a CUPS-shaped `%%BeginSetup` block. Keep IPP the default path.
- In PostScript mode the printer reads the document, not the IPP attributes: anything the job needs, copies included, belongs in the setup block. Never send the same instruction both ways.
- `ps2write` output scales with pages, not with the PDF: a few MB per colour page, whatever the upload weighed. Never size a buffer or limit for it off `MAX_UPLOAD_MB`, and keep the document out of JavaScript strings (V8 caps them near 512 MB).
- Some printers (the Toshiba e-STUDIO fixture) only take tray and paper type inside `media-col`. Validate and evaluate constraints on the flat map (`buildAttributes`); fold `media`/`media-source`/`media-type` into `media-col` only when building Print-Job attributes (`buildJobAttributes`).
- Develop and test against `ippeveprinter` (ships with CUPS; `/usr/bin/ippeveprinter` on macOS, `cups-ipp-utils` on Debian). The end-to-end test starts it itself and skips if it is missing.
- Fixtures in `fixtures/` are verbatim Get-Printer-Attributes dumps from `pnpm dump-caps <uri>`; never hand-edit them.
- Validation: `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build` (see `.github/workflows/checks.yml`).
- pnpm 11's default `trustPolicy: no-downgrade` rejects `semver@6.3.1` (pinned by `@babel/core`); the exclusion lives in `pnpm-workspace.yaml`. Copy that file into any Docker stage that runs `pnpm install`, or the install fails there too.
- UI: category-standard product UI played straight, at Linear's level of craft (Bevan's standing preference). Tokens and every component style live in `src/client/styles.css`; shared components in `src/client/components/ui.tsx`; icons are authored 16px SVG in `Icons.tsx`. No web fonts or CDNs: assets must work on an isolated LAN.
