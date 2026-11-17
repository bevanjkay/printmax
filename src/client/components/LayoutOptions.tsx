import type { Layout, LayoutTemplate } from "../../shared/layout.js";
import type { FormField, ValidationResult } from "../../shared/types.js";
import type { DocumentInfo } from "../util.js";
import type { OptionValues } from "./OptionsForm.js";
import { useId, useState } from "react";
import { mediaSize, paperChoice } from "../../shared/attributes.js";
import { arrangementOptions, describeLayout, describeTemplate, hasRoom, LAYOUT, LAYOUT_LIMITS, LAYOUT_TEMPLATES, layoutFrom, NO_LAYOUT_OPTIONS, PAGES_PER_SHEET, placePages, readLayout, sameArrangement, sheetFor, templatePaper, templatePiece } from "../../shared/layout.js";
import { IconChevron } from "./Icons.js";
import { OptionsForm } from "./OptionsForm.js";
import { Button, Notice, NumberInput } from "./ui.js";

type Problems = ValidationResult["layout"];

interface Props {
  /** The printer's whole form: the layout fields are read from it, and a ready-made layout chooses its paper on it. */
  fields: FormField[];
  value: OptionValues;
  onChange: (next: OptionValues) => void;
  /** What could be read of the chosen file; a preset has none. */
  document?: DocumentInfo | null;
  /** What the server makes of the layout, once it has answered. */
  problems: Problems | null;
}

/** A4, for a sketch drawn before the server has said which paper the job is on. */
const NOMINAL_PAPER = { width: 595, height: 842 };
const SKETCH_LONG_SIDE = 112;
/** The least a page can measure in the sketch and still hold its number. */
const NUMBERED = { width: 16, height: 13 };

/** A ready-made layout the options match, where the printer offers its paper and the job is on it. */
function chosenTemplate(fields: FormField[], value: OptionValues, layout: Layout | null): LayoutTemplate | null {
  return LAYOUT_TEMPLATES.find((template) => {
    const paper = paperChoice(fields, template.paper, templatePaper(template));
    return layout !== null && paper !== null && sameArrangement(layout, template.layout) && String(value[paper.name]) === String(paper.value);
  }) ?? null;
}

/**
 * The first sheet in miniature, drawn from the same placements the server prints from. Before a
 * document is chosen the pages take the shape of a ready-made layout's piece, or of the paper.
 */
function Sketch({ fields, value, document, problems }: Pick<Props, "fields" | "value" | "document" | "problems">) {
  const active = layoutFrom(value);
  // An image has no size of its own, so the server always resizes it to its space.
  const layout = { ...readLayout(value), ...(document?.image ? { fit: true } : {}) };
  const template = chosenTemplate(fields, value, active);
  const paper = problems?.paper ?? (typeof value.media === "string" ? mediaSize(value.media) : null) ?? (template ? templatePaper(template) : NOMINAL_PAPER);
  const page = document?.size ?? document?.shape ?? (template ? templatePiece(template) : paper);
  const fits = hasRoom(paper, layout);
  const sheet = active && fits ? sheetFor(paper, layout, page) : paper;
  const pages = layout.repeat ? 1 : document?.pages ?? layout.columns * layout.rows;
  const placements = !active
    ? [{ page: 0, x: 0, y: 0, width: sheet.width, height: sheet.height }]
    : fits ? placePages(sheet, layout, Array.from<typeof page>({ length: pages }).fill(page), 0) : [];

  const scale = SKETCH_LONG_SIDE / Math.max(sheet.width, sheet.height);
  // Crop marks drawn to scale would be a fraction of a pixel, so they are drawn large enough to see.
  const [near, far] = [1.5 / scale, 5.5 / scale];
  const state = (problems?.errors.length ?? 0) > 0 || !fits ? " failed" : (problems?.warnings.length ?? 0) > 0 ? " warned" : "";
  const label = !active
    ? "One page on each sheet."
    : `${sheet.width > sheet.height ? "A sheet on its side" : "An upright sheet"}, ${layout.columns} across and ${layout.rows} down${layout.repeat ? ", the same page in every space" : ""}.`;

  return (
    <div className="sheet-frame">
      <svg
        className={`sheet-sketch${layout.borders ? " bordered" : ""}${state}`}
        role="img"
        aria-label={label}
        width={Math.round(sheet.width * scale)}
        height={Math.round(sheet.height * scale)}
        viewBox={`0 0 ${sheet.width} ${sheet.height}`}
      >
        {placements.map((placed, place) => {
          // The sheet is measured from its bottom-left, as paper is; SVG counts down from the top.
          const top = sheet.height - placed.y - placed.height;
          const [left, right, bottom] = [placed.x, placed.x + placed.width, top + placed.height];
          return (
            // eslint-disable-next-line react/no-array-index-key -- a sheet's spaces are fixed places, which is what the index names
            <g key={place}>
              <rect className="sheet-page" x={left} y={top} width={placed.width} height={placed.height} />
              {placed.width * scale >= NUMBERED.width && placed.height * scale >= NUMBERED.height && (
                <text x={left + placed.width / 2} y={top + placed.height / 2} fontSize={11 / scale} textAnchor="middle" dominantBaseline="central">{placed.page + 1}</text>
              )}
              {active && layout.cropMarks && (
                <path
                  className="sheet-mark"
                  d={[[left, top, -1, -1], [right, top, 1, -1], [left, bottom, -1, 1], [right, bottom, 1, 1]]
                    .map(([x, y, dx, dy]) => `M${x! + dx! * near} ${y}H${x! + dx! * far}M${x} ${y! + dy! * near}V${y! + dy! * far}`)
                    .join("")}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * The arrangements one click away: the everyday pages per sheet, then the ready-made layouts for
 * pieces cut from a larger sheet. They are one choice, so they are one group of radio buttons.
 */
function Choices({ fields, value, onChange }: Pick<Props, "fields" | "value" | "onChange">) {
  const groupId = useId();
  const pagesLabelId = useId();
  const cutLabelId = useId();
  // The paper a ready-made layout took the job off, to give back when another arrangement is chosen.
  const [switched, setSwitched] = useState<{ name: string; from: unknown; to: string | number } | null>(null);
  const active = layoutFrom(value);
  const template = chosenTemplate(fields, value, active);
  const offered = LAYOUT_TEMPLATES.flatMap((t) => {
    const paper = paperChoice(fields, t.paper, templatePaper(t));
    return paper ? [{ template: t, paper }] : [];
  });
  const stillSwitched = switched !== null && String(value[switched.name]) === String(switched.to);

  /** Chooses an everyday arrangement, on the paper the job was on before a ready-made layout changed it. */
  function arrange(next: OptionValues) {
    if (switched && stillSwitched) {
      if (switched.from === undefined)
        delete next[switched.name];
      else
        next[switched.name] = switched.from;
    }
    setSwitched(null);
    onChange(next);
  }

  const card = (key: string, title: string, detail: string, checked: boolean, choose: () => void) => (
    <label key={key} className={`preset-card${checked ? " active" : ""}`}>
      <input type="radio" name={groupId} checked={checked} onChange={choose} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </label>
  );
  const paperField = switched ? fields.find(f => f.name === switched.name) : undefined;
  const paperBefore = paperField?.choices?.find(c => String(c.value) === String(switched?.from))?.label;

  return (
    <div className="layout-choices" role="radiogroup" aria-label="Layout">
      <div className="field">
        <span className="field-label" id={pagesLabelId}>Pages per sheet</span>
        <div className="preset-list" role="group" aria-labelledby={pagesLabelId}>
          {card("one", "One page", "Each page on its own sheet", active === null, () => arrange({ ...value, ...NO_LAYOUT_OPTIONS }))}
          {PAGES_PER_SHEET.map(choice => card(
            choice.id,
            choice.name,
            choice.detail,
            active !== null && template === null && sameArrangement(active, choice.layout),
            () => arrange({ ...value, ...arrangementOptions(choice.layout) }),
          ))}
        </div>
      </div>
      {offered.length > 0 && (
        <div className="field">
          <span className="field-label" id={cutLabelId}>Cut from A3</span>
          <div className="preset-list" role="group" aria-labelledby={cutLabelId}>
            {offered.map(({ template: t, paper }) => card(t.id, t.name, describeTemplate(t), template === t, () => {
              // Off its paper, the job is on one the user chose, which is the one to give back: an older record has expired.
              if (String(value[paper.name]) !== String(paper.value))
                setSwitched({ name: paper.name, from: value[paper.name], to: paper.value });
              onChange({ ...value, ...arrangementOptions(t.layout), [paper.name]: paper.value });
            }))}
          </div>
          {stillSwitched
            ? <span className="field-hint" role="status">{`Paper size is now A3. A pages per sheet choice above puts ${paperBefore ?? "the printer's own paper"} back.`}</span>
            : <span className="field-hint">Each fills the sheet with one page over and over, and switches the paper to A3.</span>}
        </div>
      )}
    </div>
  );
}

/** What is wrong with the layout, beside the layout, with the way out where there is one. */
function LayoutProblems({ value, onChange, problems }: Pick<Props, "value" | "onChange" | "problems">) {
  if (!problems)
    return null;
  if (problems.errors.length > 0) {
    return (
      <div className="layout-problems">
        <Notice tone="error">
          <strong>This layout can't be printed.</strong>
          <ul>{problems.errors.map(e => <li key={e}>{e}</li>)}</ul>
        </Notice>
      </div>
    );
  }
  if (problems.warnings.length === 0)
    return null;
  return (
    <div className="layout-problems">
      <Notice tone="warning">
        <strong>Check the fit before you print.</strong>
        <ul>{problems.warnings.map(w => <li key={w}>{w}</li>)}</ul>
        {!readLayout(value).fit && <Button size="sm" onClick={() => onChange({ ...value, [LAYOUT.fit]: "true" })}>Resize pages to fit</Button>}
      </Notice>
    </div>
  );
}

/** The grid and how pages sit in it. Options that do nothing for the layout as it stands are left out until they would. */
function Controls({ fields, value, onChange, document }: Pick<Props, "fields" | "value" | "onChange" | "document">) {
  const layout = readLayout(value);
  const active = layoutFrom(value) !== null;
  const single = layout.columns * layout.rows === 1;
  const image = document?.image ?? false;
  const field = (name: string) => fields.find(f => f.name === name);
  const set = (name: string, next: string | number) => onChange({ ...value, [name]: next });

  const number = (name: string, current: number, min: number, max: number, showHint = true) => (
    <label className="field">
      <span className="field-label">{field(name)?.label}</span>
      <NumberInput min={min} max={max} value={current} onChange={next => set(name, next)} />
      {showHint && field(name)?.help && <span className="field-hint">{field(name)?.help}</span>}
    </label>
  );
  const check = (name: string, checked: boolean, locked?: string) => (
    <label key={name} className={`check-row${locked ? " disabled" : ""}`}>
      <input type="checkbox" checked={checked} disabled={Boolean(locked)} onChange={e => set(name, String(e.target.checked))} />
      <span>
        {field(name)?.label}
        <span className="field-hint">{locked ?? field(name)?.help}</span>
      </span>
    </label>
  );

  return (
    <div className="layout-controls">
      <div className="grid-pair">
        {number(LAYOUT.columns, layout.columns, 1, LAYOUT_LIMITS.grid, false)}
        <span className="times" aria-hidden="true">×</span>
        {number(LAYOUT.rows, layout.rows, 1, LAYOUT_LIMITS.grid, false)}
      </div>
      <div className="check-list">
        {!single && check(LAYOUT.repeat, layout.repeat)}
        {active && check(LAYOUT.fit, layout.fit || image, image ? "An image has no size of its own, so it always fills its space." : undefined)}
        {active && check(LAYOUT.rotate, layout.rotate)}
        {check(LAYOUT.cropMarks, layout.cropMarks)}
        {check(LAYOUT.borders, layout.borders)}
      </div>
      {active && (
        <details className="disclosure">
          <summary>
            <IconChevron className="icon chev" />
            Spacing and order
            <span className="disclosure-note">{`· ${layout.margin} mm margin${single ? "" : `, ${layout.gap} mm gap`}`}</span>
          </summary>
          <div className="disclosure-body form-grid">
            {number(LAYOUT.margin, layout.margin, 0, LAYOUT_LIMITS.space)}
            {!single && number(LAYOUT.gap, layout.gap, 0, LAYOUT_LIMITS.space)}
            {!single && (
              <label className="field">
                <span className="field-label">{field(LAYOUT.order)?.label}</span>
                <select className="control" value={layout.order} disabled={layout.repeat} onChange={e => set(LAYOUT.order, e.target.value)}>
                  {field(LAYOUT.order)?.choices?.map(c => <option key={String(c.value)} value={String(c.value)}>{c.label}</option>)}
                </select>
                <span className="field-hint">{layout.repeat ? "Every space holds the same page." : field(LAYOUT.order)?.help}</span>
              </label>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * The Layout section, closed until asked for: one-click arrangements, then a sketch of the sheet
 * beside the grid. A problem with the layout shows under the heading even while the section is
 * closed, since a preset can bring one in unseen.
 */
export function LayoutSection({ fields, value, onChange, document = null, problems, as = "disclosure" }: Props & { as?: "disclosure" | "accordion" }) {
  const [open, setOpen] = useState(false);
  const layout = layoutFrom(value);
  const note = layout ? describeLayout(layout) : "one page per sheet";
  const trouble = problems && problems.errors.length > 0
    ? <span className="disclosure-flag danger-text">· can't print</span>
    : problems && problems.warnings.length > 0 ? <span className="disclosure-flag warning-text">· check the fit</span> : null;
  const notice = <LayoutProblems value={value} onChange={onChange} problems={problems} />;
  const body = (
    <>
      <Choices fields={fields} value={value} onChange={onChange} />
      {notice}
      <div className="layout-detail">
        <Sketch fields={fields} value={value} document={document} problems={problems} />
        <Controls fields={fields} value={value} onChange={onChange} document={document} />
      </div>
    </>
  );

  if (as === "accordion") {
    return (
      <>
        <div className="accordion">
          <details onToggle={e => setOpen(e.currentTarget.open)}>
            <summary>
              <IconChevron className="icon chev" />
              Layout
              {trouble}
              <span className="section-count">{note}</span>
            </summary>
            <div className="accordion-body">{body}</div>
          </details>
        </div>
        {!open && notice}
      </>
    );
  }
  return (
    <>
      <details className="disclosure" onToggle={e => setOpen(e.currentTarget.open)}>
        <summary>
          <IconChevron className="icon chev" />
          Layout
          <span className="disclosure-note">{`· ${note}`}</span>
          {trouble}
        </summary>
        <div className="disclosure-body">{body}</div>
      </details>
      {!open && notice}
    </>
  );
}

/**
 * Copies, and beside it what they come to when every sheet repeats one page. Either can be typed:
 * asking for 40 of each page works out the copies, rounded up to whole sheets.
 */
export function Quantity({ fields, value, onChange, pages }: Pick<Props, "fields" | "value" | "onChange"> & { pages: number | null }) {
  const totalId = useId();
  const copiesField = fields.filter(f => f.name === "copies");
  const layout = layoutFrom(value);
  if (copiesField.length === 0)
    return null;
  const stepper = <OptionsForm fields={copiesField} value={value} onChange={onChange} friendly />;
  if (!layout?.repeat)
    return stepper;
  const perSheet = layout.columns * layout.rows;
  const copies = Math.max(1, Number(value.copies ?? copiesField[0]!.default ?? 1) || 1);
  const each = pages === 1 ? "" : " of each page";
  return (
    <div>
      <div className="run">
        {stepper}
        <span className="run-equals" aria-hidden="true">=</span>
        <div className="field">
          <label className="field-label" htmlFor={totalId}>{pages === 1 ? "In total" : "Of each page"}</label>
          <NumberInput
            id={totalId}
            className="control copies"
            min={perSheet}
            max={(copiesField[0]!.max ?? 999) * perSheet}
            value={copies * perSheet}
            onChange={total => onChange({ ...value, copies: Math.ceil(total / perSheet) })}
          />
        </div>
      </div>
      <p className="field-hint run-hint">{`${perSheet} to a sheet, so ${copies} ${copies === 1 ? "copy prints" : "copies print"} ${copies * perSheet}${each}.`}</p>
    </div>
  );
}
