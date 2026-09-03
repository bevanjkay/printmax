---
name: printmax
description: Category-standard product UI for printing over IPP; neutral greys, one indigo accent, a form and a table.
colors:
  bg: "#f7f7f9"
  surface: "#ffffff"
  surface-2: "#f1f1f4"
  surface-3: "#e9e9ee"
  border: "#e3e4e9"
  border-strong: "#cdcfd7"
  text: "#16171b"
  text-2: "#5c606c"
  text-3: "#6f7380"
  accent: "#5158c9"
  accent-hover: "#444bb4"
  accent-soft: "#ecedfb"
  accent-ring: "rgba(81, 88, 201, 0.35)"
  on-accent: "#ffffff"
  success: "#146b3f"
  success-soft: "#e4f4ea"
  warning: "#9a5b07"
  warning-soft: "#fbf0dc"
  danger: "#c0392b"
  danger-soft: "#fbe8e6"
  danger-border: "#f0b9b3"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.5
  mono:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "0.92em"
    fontWeight: 400
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  2xs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
  page-x: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
  button-primary-disabled:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-3}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-danger-hover:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
  button-danger-armed:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-accent}"
  button-lg:
    typography: "{typography.body}"
    padding: "0 16px"
    height: "38px"
  button-sm:
    typography: "{typography.label}"
    padding: "0 10px"
    height: "28px"
  control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  control-disabled:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
  badge:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 8px 0 7px"
    height: "22px"
  badge-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
  badge-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
  badge-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
  badge-info:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  chip:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "0 7px"
    height: "20px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "20px"
  panel-footer:
    backgroundColor: "{colors.surface-2}"
    padding: "12px 20px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "32px"
  nav-item-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
  dropzone:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-2}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "16px"
    height: "104px"
  dropzone-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.text}"
  preset-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  preset-card-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.text}"
  stepper:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    height: "32px"
  segmented-full:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px"
    height: "32px"
  table-header:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    padding: "8px 12px"
  notice:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
---

# Design System: printmax

## Overview

**Creative North Star: "The Tool That Disappears"**

printmax is the category standard for product UI, played straight and finished to Linear's level of craft. Every page is a form and a table; nothing else competes. There is no hero metric, no card-grid dashboard, no illustration, and no brand colour beyond one indigo reserved for the primary action, selection and focus. The surfaces are neutral greys separated by 1px borders, the type is the operating system's own sans on a fixed five-step scale with tabular numerals, and the icons are sixteen hand-drawn 1.5px strokes on one grid. The product identity is neutral by commitment: nothing is organisation-specific and nothing is decorative.

Density is the same everywhere. A volunteer on a phone and an administrator at a desk read the same 13px table rows, the same 32px controls, the same 22px state badges; the phone layout stacks the same components rather than substituting friendlier ones. Depth is tonal, not cast: panels sit on a slightly darker page, footers sit on a slightly darker panel, and the only shadows are a 1px lift on the active nav item and a soft float on the sign-in card. Light is the default; dark follows the system preference with the same grey ladder inverted and the indigo lifted for contrast.

Motion is one duration (180ms) and one easing, used for hover, focus and the single signature moment: a dropped file cross-fades out of the drop zone and a job row fades into the table beneath. Nothing else animates.

**Key Characteristics:**
- Neutral grey ladder (page, surface, surface-2, surface-3) with 1px borders doing all the structural work.
- One indigo accent, used only for the primary button, the brand mark, selection, focus and the "in progress" badge.
- System font stack on a fixed 12/13/14/16/20px scale; tabular numerals on every number column.
- Authored 16px, 1.5px round-stroke icons in `currentColor`; no icon fonts, no packages.
- State badges always carry a word; colour never carries state alone.
- Fully self-hosted: no web fonts, no CDNs, no runtime requests outside the app.

## Colors

A cool grey ladder carries the whole interface; a single indigo marks what you can act on; three semantic colours (green, amber, red) each come as an ink plus a soft tint and are used only to label state.

### Primary
- **Indigo** (`accent`): the Print button, the sign-in button, the brand mark, the avatar initials, the active `caret-color` and `accent-color`, link colour, the focus outline, the selected preset card's border, and the "info" and "progress" badge inks. In dark mode it lifts to `#7c83e6` so it holds contrast on near-black.
- **Indigo Deep** (`accent-hover`): the primary button's hover and active fill only.
- **Indigo Wash** (`accent-soft`): text selection, the avatar disc, the selected preset card, the drop zone while a file is dragged over it, and the tint behind info/progress badges. In dark mode it becomes a 16% alpha of the lifted indigo.
- **Indigo Ring** (`accent-ring`): the 3px focus halo around inputs and selects (`box-shadow: 0 0 0 3px`).
- **On Indigo** (`on-accent`): text on any indigo fill. White in light, near-black (`#0e0f11`) in dark.

### Neutral
- **Page** (`bg`): the app background behind everything.
- **Surface** (`surface`): panels, table bodies, inputs, secondary buttons, the active nav item, the mobile top bar.
- **Surface Two** (`surface-2`): the sidebar, panel footers, table headers, hover fill on buttons and rows, the neutral notice, the segmented control track, and a filled drop zone.
- **Surface Three** (`surface-3`): the neutral badge and chip fill, button active fill, nav hover, skeleton bars, and the disabled primary button.
- **Border** (`border`): every 1px structural line: panel edges, table rules, dividers, the sidebar edge.
- **Border Strong** (`border-strong`): control and button outlines, the dashed drop zone edge, the scrollbar thumb.
- **Ink** (`text`): headings, primary cell text, control values.
- **Ink Two** (`text-2`): descriptions, field labels, table headers, nav items at rest, metadata, secondary cells.
- **Ink Three** (`text-3`): hints, placeholders, empty-state icons, the disclosure chevron, disabled primary text.

### Semantic (state inks and tints)
- **Success** (`success` / `success-soft`): `idle` printers and `completed` jobs; the success notice tint.
- **Warning** (`warning` / `warning-soft`): `retrying`, `pending-held`, `processing-stopped`; the pending-changes count pill in the nav; the warning notice tint.
- **Danger** (`danger` / `danger-soft` / `danger-border`): `failed`, `aborted`, `stopped`; the danger button ink and its hover tint; the error notice fill and edge; invalid control borders; printer state reasons inline.

Dark mode redefines every token above under `prefers-color-scheme: dark` in `src/client/styles.css`; the semantic inks brighten and their tints become 14% alpha of the ink. The dark values are carried in `.impeccable/design.json` under `colorMeta.<token>.dark`.

### Named Rules
**The One Indigo Rule.** Indigo appears on exactly one filled button per panel and otherwise only as focus, selection, the brand mark and the in-progress badge. If a screen has two indigo fills, one of them is wrong.

**The Word Beside the Dot Rule.** Every state badge is a 6px dot in `currentColor` plus the state word (`idle`, `completed`, `retrying`). The colour is confirmation, never the message.

**The Tint Never Stands Alone Rule.** A soft tint (`*-soft`) is only ever paired with its ink on the same element: badge, notice, hover fill. Tints are not used as page or panel backgrounds.

## Typography

**Display Font:** none; there is no display face.
**Body Font:** the system sans stack (`system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`)
**Label/Mono Font:** the system monospace stack (`ui-monospace, "SF Mono", Menlo, Consolas, monospace`), for IPP URIs and code only

**Character:** Deliberately unbranded. The operating system's own face at five fixed sizes, weight 600 for headings and 500 for anything interactive or labelling, 400 for everything else. Headings carry a slight negative track (-0.01em) so they sit tight; nothing else is tracked. Numbers are tabular wherever they align in a column.

### Hierarchy
- **Headline** (600, 20px, 1.3, -0.01em): the page title only (`Print`, `Jobs`, `Printers`). One per page, top-left, followed by a 13px `text-2` description on the next line.
- **Title** (600, 14px, 1.3, -0.01em): panel headers (`Add a printer`), section titles (`Recent jobs`), empty-state titles, printer names in admin cards. The sign-in card is the one place a 16px title appears.
- **Body** (400, 14px, 1.5): the base body size, used for the mobile `Print` button and the large-button label. Most running text is actually one step smaller.
- **Body Small** (400, 13px, 1.5): the working size of the product: table cells, controls, buttons, nav items, notices, descriptions, hints beside state, key-value lists.
- **Label** (500, 12px): field labels, table headers, badges, chips, `btn-sm`, the sidebar footer's role line, counts. Never uppercase; never letter-spaced.
- **Mono** (0.92em of the parent): IPP addresses and any raw identifier; inherits colour.

### Named Rules
**The Five Sizes Rule.** 12, 13, 14, 16 and 20px are the only sizes. There is no clamp, no fluid type, and no size above 20px anywhere in the product.

**The Tabular Column Rule.** Any cell or count that sits under another number sets `font-variant-numeric: tabular-nums` (`.num`); dates and job IDs included.

**The Sentence Case Rule.** Every label, button, header and badge is sentence case. State words arrive as the printer spelled them (`pending-held` becomes `pending held`), never capitalised or shouted.

## Layout

The desktop shell is a fixed 240px sidebar (`surface-2`, 1px right border, sticky, full viewport height) beside a fluid main column. The sidebar holds the brand row (32px), six nav items (32px each, 2px apart, 18px below the brand), and a footer pinned to the bottom with the avatar, name, role and a ghost sign-out icon button. Page content is centred at a maximum of 1120px with 32px top and 40px side padding and 72px bottom padding; there is no page-level grid beyond that.

Inside a page the primary rhythm is 16px between stacked blocks (`.stack`, `.panel + .panel`) and 20px inside a panel body. Forms use a two-column grid (`.two-col`, 24px gutter) or an auto-fill grid of 190px minimum columns (`.form-grid`, 16px gutter) for the generated option editor. Admin pages use a 3:2 split (`.split`, 20px gutter) or a main column beside a fixed 320px aside (`.split.narrow-aside`). Fields stack with a 6px label gap and 14px below each field; compact fields close to 8px. Section titles sit 28px above their table and 10px from it.

The print panel is three stacked bodies separated by 1px rules: the document drop zone; the printer select with its live state beside a copies stepper in the two-column grid; then the preset cards under `How to print it`, with every other option folded in an `Adjust this job` disclosure. When the printer has no presets the third body is instead a quick-options row of the primary attributes (duplex, colour, paper, quality, finishing) with a `More options` disclosure for the rest. The footer status reads the job back in plain words (`Will print 1 copy · Double-sided, long edge · Black and white · Letter (8.5×11 in) · Draft.`) from `summariseOptions` in `src/client/util.ts`; before a file is chosen it says `Add a document above to print.` Tables are edge-to-edge inside their rounded wrap; header cells pad 8px/12px, body cells 9px/12px, first column 16px.

At 880px and below the sidebar is replaced by a sticky top bar (`surface`, 1px bottom border, safe-area aware): a 48px brand row with a small ghost sign-out, then the same nav as a horizontally scrolling strip that fades out at its right edge. Page padding drops to 16px, all two-column and split grids collapse to one column, panel padding drops to 16px, and every button, control and nav item grows to a minimum 36px (controls to 40px at 16px type so iOS does not zoom; the Print button to 44px and full width). The jobs table drops its header and re-lays each row as a small grid: document and state on the first line, the printer's words beneath, then printer and time with the action beside.

### Named Rules
**The One Panel, One Table Rule.** A page is a title, at most one form panel, and a table (or key-value list) beneath. Nothing sits beside the form on a phone and nothing sits above the fold except the form.

**The Same Density Rule.** Phone and desktop share every size except touch targets. Do not enlarge type, loosen tables or swap components on small screens; stack them.

## Elevation & Depth

The system is tonal. Structure is drawn with the grey ladder and 1px `border` lines, not with shadows: the page is slightly darker than a panel, a panel footer and table header are slightly darker than their panel, the sidebar is a shade darker than the main column. Shadows exist in only two roles and both are quiet.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 1px 2px rgba(16, 17, 20, 0.06)`, `--shadow-sm`): the active nav item and the selected segment of a segmented control. It says "this one is raised" without a colour change.
- **Float** (`box-shadow: 0 8px 24px -8px rgba(16, 17, 20, 0.22), 0 2px 6px rgba(16, 17, 20, 0.06)`, `--shadow-md`): the sign-in card only, which has no border and floats over the page.

In dark mode both shadows deepen (40% and 60%/30% black) since the surfaces are already near-black.

### Named Rules
**The Border Before Shadow Rule.** If a surface needs an edge, it gets a 1px `border`. A shadow is added only to mark a selected item (Lift) or a lone modal-like card (Float). Panels, tables, dropdowns and buttons never cast shadows.

**The Focus Is a Ring Rule.** Keyboard focus on any element is a 2px indigo outline offset 2px (`:focus-visible`); text controls swap it for a 3px `accent-ring` halo with an indigo border. Focus is never expressed by colour fill alone.

## Shapes

Corners follow container size: 12px on panels, table wraps and the sign-in card (`lg`); 8px on the drop zone, preset cards and notices (`md`); 6px on buttons, controls, nav items, the disclosure summary and the focus outline (`sm`); 4px on the elements that nest inside those (chips, skeleton bars, segmented buttons; `xs`). Badges and the nav count are pills (`999px`); avatars are circles; the 20px brand mark is a 5px-radius indigo tile holding a 12px white printer glyph.

Every bounded surface has a 1px border: `border` for structural surfaces, `border-strong` for anything you type into or click. The drop zone is the one dashed edge in the product (1.5px, `border-strong`), turning solid `border` once a file is present and solid indigo while a file is dragged over it. Table rows are separated by 1px `border` rules with the last rule removed so the wrap's corner stays clean; panel footers inherit the panel's bottom corners.

Icons are drawn on a 16×16 grid with 1.5px round-capped, round-joined strokes in `currentColor` and no fills: printer, jobs (three lines), presets (bookmark), sliders, users, user, logout, upload, file, chevron, check, refresh, alert, info, plus, search, inbox, and a spinner. They render at 16px in buttons and nav, 20px in the drop zone, 24px in empty states, 12px inside the brand mark.

## Components

### Buttons
Quiet, bordered, 32px tall, sentence case. Icons sit 6px before the label.
- **Shape:** softly rounded (6px), 1px border, `body-sm` at weight 500, 12px side padding.
- **Primary:** indigo fill, indigo border, white text. Hover and active deepen to `accent-hover`. Disabled becomes a `surface-3` block with `text-3` text at full opacity, so the disabled Print button reads as "not yet" rather than "broken".
- **Secondary (default):** `surface` fill, `border-strong` edge, `text`. Hover `surface-2`, active `surface-3`. Disabled at 50% opacity.
- **Ghost:** no border, no fill, `text-2`; hover `surface-2` and `text`. Used for `All jobs`, sign-out, and icon-only actions (`btn-icon`, 28px square).
- **Danger:** secondary shape with `danger` ink; hover `danger-soft` fill and `danger-border` edge. Confirm-to-act buttons go **armed** on first click: solid `danger` fill, white text, until clicked again or timed out.
- **Sizes:** `lg` (38px, 14px type, 16px padding) is reserved for the panel-footer primary action; `sm` (28px, 12px type, 10px padding) for row actions and toolbar buttons.
- **Loading:** the icon slot swaps for a 14px spinner and the label changes to a present participle (`Sending`); `aria-busy` is set.
- **Transitions:** background, border and colour over 180ms.

### Inputs / Fields
Text inputs, selects, number inputs and the file input share one `control` class.
- **Style:** 32px tall, 1px `border-strong`, 6px radius, `surface` fill, `body-sm` type, 10px side padding, placeholder in `text-3`. Selects hide the native arrow and draw a 16px stroke chevron 8px from the right edge, with 30px right padding; the chevron is `text-3` in each scheme (`#6f7380` light, `#8f939e` dark) via a per-scheme data URI.
- **Hover:** border to `text-3`.
- **Focus:** outline removed; border to indigo plus a 3px `accent-ring` halo.
- **Error / Disabled:** `aria-invalid` sets a `danger` border; disabled fills `surface-2` with `text-2`.
- **Field wrapper:** a `label` element stacking a 12px/500 `text-2` label, the control, then either a 12px `text-3` hint or a 12px `danger` error (never both), 6px apart, 14px below.
- **Checks:** 15px native checkboxes and radios (indigo via `accent-color`) with 7px to their 13px label, wrapped in a 32px-minimum group.
- **Segmented control:** an inline 2px-padded `surface-2` track with 1px `border`, holding 26px 12px/500 buttons; the active one is `surface` with the Lift shadow. The **full** variant stretches to the field's width at 32px (40px on phones) with equal-width buttons that may wrap to two lines (`aria-pressed` marks the choice); the quick-options row uses it for any printer choice with two or three values and hides fields with only one.
- **Stepper:** copies only. A 32px (40px on phones) `border-strong` box at 6px radius holding a 34px (44px) minus button, a 56px centred number input between two 1px `border` rules (native spinners hidden), and a 34px plus button with the 16px plus icon. Buttons are `text-2` at 16px, hover `surface-2`, and fade to 40% at the range ends; the input's focus is a 2px inset `accent-ring` instead of the outer halo.

### Cards / Containers
The **Panel** is the only container.
- **Corner Style:** 12px.
- **Background:** `surface` body; optional header (12px/20px, bottom border, 14px/600 title with actions on the right) and optional footer (`surface-2`, top border, 12px/20px, actions right-aligned with a 13px `text-2` status line pushed left).
- **Shadow Strategy:** none; 1px `border`. The sign-in card is the exception (no border, Float shadow, 380px maximum).
- **Border:** 1px `border`; stacked bodies inside one panel are separated by a 1px top border.
- **Internal Padding:** 20px (16px on phones).

### Tables
- **Wrap:** 1px `border`, 12px radius, `surface`, horizontal scroll if needed.
- **Header:** `surface-2`, 12px/500 `text-2`, left-aligned, no wrap.
- **Rows:** 13px, 9px/12px cell padding, 1px rules, `surface-2` on hover; a `primary` cell at weight 500 for the row's name, `meta` cells at 12px `text-2` truncated at 360px, `num` cells tabular, an `actions` cell right-aligned. A newly appeared row fades in over 180ms.
- **Empty and loading:** an `EmptyState` (24px icon, title, 13px description capped at 44ch, optional button) or `SkeletonRows` (12px `surface-3` bars at descending widths) inside the same wrap.

### Badges and Chips
- **State badge:** 22px pill, 12px/500, 6px `currentColor` dot before the word; `neutral` (`surface-3`/`text-2`), `success`, `warning`, `danger`, `info` (indigo) and `progress` (indigo with a 1.4s pulsing dot). `StateBadge` maps IPP and local states to tones in `src/client/util.ts` and replaces hyphens with spaces. `plain` drops the dot for non-state labels.
- **Chip:** 20px, 4px radius, `surface-3` with `text-2` at 12px; an optional `b` value in `text` at weight 500. Used for preset option summaries.
- **Count pill:** in the nav, an 18px `warning-soft`/`warning` pill for pending capability changes.

### Navigation
- **Sidebar item:** 32px, 6px radius, 10px icon gap, 13px/500 `text-2`; hover `surface-3` and `text`; active `surface`, `text`, Lift shadow, `aria-current="page"`.
- **Mobile strip:** the same items at 34px in a horizontally scrolling row (hidden scrollbar, right-edge fade mask); active is `surface-2` with no shadow.
- **Brand:** 20px indigo tile with printer glyph, 8px gap, `printmax` at 14px/600 lowercase.

### Notices
Inline, never toasts. 10px/12px padding, 8px radius, 13px, a 16px icon top-aligned beside the text, optional list and an 8px-spaced action button beneath. `info` is `surface-2` with an indigo icon; `error` is `danger-soft` with a `danger-border` edge and `role="alert"`; `warning` and `success` are their tints with no visible border. The validation notice is an error notice listing the printer's own conflicts with an "apply the printer's fix" secondary button.

### Drop Zone (signature)
The first body of the print panel. A 104px-minimum, 8px-radius, 1.5px-dashed `border-strong` box in `surface` with a 20px `text-3` upload icon, `Drop a file here` at weight 500 beside `or click to choose`, and `PDF, PNG or JPEG` beneath at 12px. Dragging over it turns the edge indigo and the fill `accent-soft`; a chosen file turns the edge solid `border`, the fill `surface-2`, and shows a 16px indigo file icon, the name at weight 500 and the size in `text-2`. Content changes fade in over 180ms. After Print the zone empties, the footer status reports `<file> is on its way to <printer>` in `success`, and the new row fades into the table below.

### Preset Cards (signature)
A radio group rendered as cards so the preset is the primary choice. `preset-list` is an auto-fill grid of 220px-minimum columns with an 8px gap (one column and a 44px minimum height on phones). Each card is a `label` wrapping a visually hidden radio: `surface`, 1px `border-strong`, 8px radius, 10px/12px padding, the preset name at 13px/500 over a 12px `text-2` line that shows the admin's description or the settings summary (`2 copies · Single-sided · Black and white · A4 (210×297 mm) · High`). Hover moves the border to `text-3`; the selected card takes an indigo border on an `accent-soft` fill; keyboard focus draws the standard 2px indigo outline on the card (`:focus-within`). A preset with unresolved problems is **unavailable**: 55% opacity, disabled, and its line reads `Needs attention; ask an admin`. The last card is always **Custom** (`Choose the options yourself`), which reveals the quick-options row beneath.

### Disclosure
A borderless `details` whose summary is a 32px, 13px/500 row with a `text-3` chevron that rotates 90 degrees when open; hover `surface-2`. Used for `Adjust this job` and `More options` on the print form and `Capability overrides` on printer cards; the summary may carry a weight-400 `text-2` aside (`· changes apply to this print only`, `· 7 more the printer supports`). The body starts 10px below.

## Do's and Don'ts

### Do:
- **Do** build every page as a title (20px/600), a description line (13px `text-2`), at most one panel, and a table or key-value list beneath.
- **Do** use the five sizes only (12/13/14/16/20px) and `tabular-nums` on any column of numbers or dates.
- **Do** label state with a `StateBadge` (dot plus word); route every new state through `stateTone()` in `src/client/util.ts` rather than picking a colour in place.
- **Do** put the primary action in a panel footer, right-aligned, `btn-primary btn-lg`, with the status line on its left; on phones it goes full width at 44px.
- **Do** offer a printer choice with two or three values as a full-width segmented toggle and copies as a stepper in the quick-options row; hide a field with a single value there and fold everything else under a disclosure.
- **Do** draw new icons on the 16px grid at 1.5px round stroke in `currentColor` and add them to `src/client/components/Icons.tsx`.
- **Do** render errors and the printer's words inline in a `Notice` or a table cell, in the printer's own text.
- **Do** define any new colour in both the light `:root` block and the dark `prefers-color-scheme` block of `src/client/styles.css`; a token with one mode is incomplete.
- **Do** keep motion to `--dur` (180ms) and `--ease`, and honour `prefers-reduced-motion` (the stylesheet already zeroes all animation and transition).

### Don't:
- **Don't** load a web font, an icon font, an icon package, or anything from a CDN; the app must run on an isolated LAN with only its own assets.
- **Don't** use indigo as a fill anywhere but the one primary button per panel, the brand mark, the avatar disc, the selected preset card's wash and the info/progress badge.
- **Don't** cast shadows on panels, tables, dropdowns or buttons; use a 1px `border`. Shadows are for the active nav item and the sign-in card only.
- **Don't** convey state by colour alone, and don't shorten or capitalise the printer's state words.
- **Don't** add uppercase, letter-spaced labels, kickers or eyebrows; every label is sentence case at 12px/500.
- **Don't** add a dashboard, metric tiles, cards-in-a-grid, illustrations, toasts or a marketing hero; this is a form and a table.
- **Don't** change density between phone and desktop beyond touch targets; stack the same components instead.
- **Don't** put organisation branding or a second accent into the product; the identity is neutral by commitment.
