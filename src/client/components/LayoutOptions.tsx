import type { DocumentSize, FormField } from "../../shared/types.js";
import type { OptionValues } from "./OptionsForm.js";
import { useId } from "react";
import { mediaSize, paperChoice } from "../../shared/attributes.js";
import { cellPosition, describeTemplate, isLayoutOption, LAYOUT_DEFAULTS, LAYOUT_TEMPLATES, layoutFrom, layoutOptions, pageInCell, POINTS_PER_MM, sameLayout, sheetFor, templatePaper } from "../../shared/layout.js";
import { OptionsForm } from "./OptionsForm.js";

/** A4, for the sketch of a sheet whose real size only the server knows. */
const NOMINAL_PAPER = { width: 595, height: 842 };
const LONG_SIDE_PX = 112;
/** The least a cell can measure and still hold its page number. */
const NUMBERED_CELL_PX = { width: 18, height: 14 };

interface Props {
  /** The printer's whole form: the layout fields are drawn from it, and a ready-made layout chooses its paper on it. */
  fields: FormField[];
  value: OptionValues;
  onChange: (next: OptionValues) => void;
  /** The document's page size where it could be read, which decides which way the sheet is turned. */
  document: DocumentSize | null;
}

/** A sketch of one sheet: which way it is turned, and which page lands in which cell. Not to scale beyond that. */
function SheetSketch({ value, document }: Pick<Props, "value" | "document">) {
  const layout = layoutFrom(value) ?? LAYOUT_DEFAULTS;
  const paper = (typeof value.media === "string" ? mediaSize(value.media) : null) ?? NOMINAL_PAPER;
  const sheet = sheetFor(paper, layout, document ?? NOMINAL_PAPER);
  const scale = LONG_SIDE_PX / Math.max(sheet.width, sheet.height);
  const width = Math.round(sheet.width * scale);
  const height = Math.round(sheet.height * scale);
  const margin = Math.round(layout.margin * POINTS_PER_MM * scale);
  // Cells that touch on paper still need telling apart in a sketch this small.
  const gap = Math.max(1, Math.round(layout.gap * POINTS_PER_MM * scale));
  const numbered = (width - margin * 2) / layout.columns >= NUMBERED_CELL_PX.width && (height - margin * 2) / layout.rows >= NUMBERED_CELL_PX.height;

  // In reading order, which is how a grid fills, each cell naming the page the layout puts there.
  const cells: Array<{ place: string; page: number }> = [];
  for (let cell = 0; cell < layout.columns * layout.rows; cell++) {
    const { row, column } = cellPosition(cell, layout);
    cells[row * layout.columns + column] = { place: `${row}-${column}`, page: pageInCell(0, cell, layout) + 1 };
  }

  return (
    <div className="sheet-frame" aria-hidden="true">
      <div
        className={`sheet-sketch${layout.borders ? " bordered" : ""}`}
        style={{ width, height, padding: margin, gap, gridTemplateColumns: `repeat(${layout.columns}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, 1fr)` }}
      >
        {cells.map(cell => <span key={cell.place}>{numbered ? cell.page : ""}</span>)}
      </div>
    </div>
  );
}

/**
 * Layouts for the sizes an office cuts from a larger sheet. Each sets the whole layout and chooses
 * its paper, so they are only offered on a printer that lists that paper.
 */
function ReadyMade({ fields, value, onChange }: Pick<Props, "fields" | "value" | "onChange">) {
  const labelId = useId();
  const current = layoutFrom(value);
  const offered = LAYOUT_TEMPLATES.flatMap((template) => {
    const paper = paperChoice(fields, template.paper, templatePaper(template));
    return paper ? [{ template, paper }] : [];
  });
  if (offered.length === 0)
    return null;
  return (
    <div className="field">
      <span className="field-label" id={labelId}>Cut from A3</span>
      <div className="preset-list" role="group" aria-labelledby={labelId}>
        {offered.map(({ template, paper }) => {
          const active = current !== null && sameLayout(current, template.layout) && String(value[paper.name]) === String(paper.value);
          return (
            <button
              key={template.id}
              type="button"
              className={`preset-card${active ? " active" : ""}`}
              aria-pressed={active}
              onClick={() => onChange({ ...value, ...layoutOptions(template.layout), [paper.name]: paper.value })}
            >
              <strong>{template.name}</strong>
              <span>{describeTemplate(template)}</span>
            </button>
          );
        })}
      </div>
      <span className="field-hint">Each fills the sheet with one page over and over, and switches the paper to A3.</span>
    </div>
  );
}

/** Ready-made layouts, then the layout fields beside a sketch of the sheet they describe. */
export function LayoutOptions({ fields, value, onChange, document }: Props) {
  // The disclosure this sits in is already the "Layout" section, so the fields' own grouping would only nest it again.
  const flat = fields.filter(f => isLayoutOption(f.name)).map(({ group: _group, ...field }) => field);
  return (
    <>
      <ReadyMade fields={fields} value={value} onChange={onChange} />
      <div className="layout-options">
        <SheetSketch value={value} document={document} />
        <OptionsForm fields={flat} value={value} onChange={onChange} />
      </div>
    </>
  );
}
