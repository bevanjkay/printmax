import type { DocumentSize, FormField } from "../../shared/types.js";
import type { OptionValues } from "./OptionsForm.js";
import { mediaSize } from "../../shared/attributes.js";
import { cellPosition, LAYOUT_DEFAULTS, layoutFrom, pageInCell, POINTS_PER_MM, sheetFor } from "../../shared/layout.js";
import { OptionsForm } from "./OptionsForm.js";

/** A4, for the sketch of a sheet whose real size only the server knows. */
const NOMINAL_PAPER = { width: 595, height: 842 };
const LONG_SIDE_PX = 112;
/** The least a cell can measure and still hold its page number. */
const NUMBERED_CELL_PX = { width: 18, height: 14 };

interface Props {
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

/** The layout fields beside a sketch of the sheet they describe. */
export function LayoutOptions({ fields, value, onChange, document }: Props) {
  // The disclosure this sits in is already the "Layout" section, so the fields' own grouping would only nest it again.
  const flat = fields.map(({ group: _group, ...field }) => field);
  return (
    <div className="layout-options">
      <SheetSketch value={value} document={document} />
      <OptionsForm fields={flat} value={value} onChange={onChange} />
    </div>
  );
}
