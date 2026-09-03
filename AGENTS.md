# printmax — agent notes

- Read `print-server-plan.md` first. It is the design; milestones and non-goals are decided.
- The app speaks IPP directly (`src/server/ipp/`). Do not add CUPS to the print path.
- Job options are a flat `{ "ipp-attribute": value }` map everywhere (presets, overrides, `options_final`). Do not invent a friendlier schema.
- Value typing and validation live in `src/server/ipp/options.ts` and are driven by the printer's own `*-supported`/`*-default` attributes. Only `KNOWN_TYPES` and `ipp/enums.ts` are hand-maintained.
- Develop and test against `ippeveprinter` (ships with CUPS; `/usr/bin/ippeveprinter` on macOS, `cups-ipp-utils` on Debian). The end-to-end test starts it itself and skips if it is missing.
- Fixtures in `fixtures/` are verbatim Get-Printer-Attributes dumps from `pnpm dump-caps <uri>`; never hand-edit them.
- Validation: `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build` (see `.github/workflows/checks.yml`).
- pnpm 11's default `trustPolicy: no-downgrade` rejects `semver@6.3.1` (pinned by `@babel/core`); the exclusion lives in `pnpm-workspace.yaml`. Copy that file into any Docker stage that runs `pnpm install`, or the install fails there too.
