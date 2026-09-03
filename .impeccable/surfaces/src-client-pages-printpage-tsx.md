---
version: 1
slug: "src-client-pages-printpage-tsx"
primary_target: "src/client/pages/PrintPage.tsx"
related_targets: ["src/client/App.tsx"]
---

# Print page (src/client/pages/PrintPage.tsx)

Scope: the default page after sign-in; the whole app shell is also decided here. Mode: Operate.

Audience and job: a church volunteer or staff member, often on a phone, with a document that needs paper now. Task: printer, preset, file, Print, in under a minute, no instruction. Admins reach the same page and expect it to stay fast.

Content and proof: the printer's live IPP state and reasons; presets carrying settings; the printer-generated options one click away; recent jobs beneath the form so the outcome is visible without leaving.

Constraints: self-hosted assets only (system font stack, authored SVG icons); one-handed phone use; honest state in the printer's own words; density over decoration.

Direction: the category standard at Linear's level. Sidebar navigation on desktop, top bar with a scrollable nav strip on phones. Neutral greys, one indigo accent for primary action, selection and focus. Compact tables with tabular numerals. Memorable moment: the file drop zone becomes the job row in the table beneath with one 180 ms cross-fade; nothing else animates.

Unresolved: whether the options disclosure should remember its open state per user.
