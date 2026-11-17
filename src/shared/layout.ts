/**
 * printmax's own layout options: several pages to a sheet, placed by printmax before the document
 * is sent, so the same choices work on any printer. They share the flat option map with everything
 * else and are stripped before the printer sees it.
 */
export const LAYOUT_PREFIX = "layout-";

export const LAYOUT = {
  columns: "layout-columns",
  rows: "layout-rows",
  order: "layout-order",
  repeat: "layout-repeat",
  fit: "layout-fit",
  rotate: "layout-rotate",
  margin: "layout-margin",
  gap: "layout-gap",
  cropMarks: "layout-crop-marks",
  borders: "layout-borders",
} as const;

export type LayoutOrder = "across" | "down";

export interface Layout {
  columns: number;
  rows: number;
  /** Which way the pages run: along each row in turn, or down each column in turn. */
  order: LayoutOrder;
  /** Fill each sheet with one page, for prints that are cut apart afterwards. */
  repeat: boolean;
  /** Scale each page to its space; off, every page keeps the size it was made. */
  fit: boolean;
  /** Turn a page a quarter when its space is the other way round. */
  rotate: boolean;
  /** Around the sheet's edge, in millimetres. */
  margin: number;
  /** Between pages, in millimetres. */
  gap: number;
  cropMarks: boolean;
  borders: boolean;
}

export const LAYOUT_DEFAULTS: Layout = { columns: 1, rows: 1, order: "across", repeat: false, fit: true, rotate: false, margin: 5, gap: 2, cropMarks: false, borders: false };

/** The most pages across or down a sheet, and the widest margin or gap in millimetres. */
export const LAYOUT_LIMITS = { grid: 10, space: 25 } as const;

export const POINTS_PER_MM = 72 / 25.4;

export interface Size {
  width: number;
  height: number;
}

export function isLayoutOption(name: string): boolean {
  return name.startsWith(LAYOUT_PREFIX);
}

function whole(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
}

function toggle(value: unknown): boolean | null {
  if (value === true || value === "true")
    return true;
  return value === false || value === "false" ? false : null;
}

const NAMES = new Set<string>(Object.values(LAYOUT));
const TOGGLES = new Set<string>([LAYOUT.repeat, LAYOUT.fit, LAYOUT.rotate, LAYOUT.cropMarks, LAYOUT.borders]);

/** What is wrong with the `layout-` entries of an option map, in words. */
export function layoutErrors(options: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const [name, value] of Object.entries(options)) {
    if (!isLayoutOption(name) || value === undefined || value === null || value === "")
      continue;
    if (!NAMES.has(name)) {
      errors.push(`"${name}" is not a layout option`);
    }
    else if (TOGGLES.has(name)) {
      if (toggle(value) === null)
        errors.push(`"${name}" must be true or false`);
    }
    else if (name === LAYOUT.order) {
      if (value !== "across" && value !== "down")
        errors.push(`"${name}" must be "across" or "down"`);
    }
    else {
      const grid = name === LAYOUT.columns || name === LAYOUT.rows;
      const [min, max] = grid ? [1, LAYOUT_LIMITS.grid] : [0, LAYOUT_LIMITS.space];
      const n = whole(value);
      if (n === null || n < min || n > max)
        errors.push(`"${name}" must be a whole number from ${min} to ${max}`);
    }
  }
  return errors;
}

/**
 * Every layout value an option map holds, each falling back to its default where it is unset or
 * unreadable, so a form can ask while a value is half typed; `layoutErrors` is what refuses a job.
 */
export function readLayout(options: Record<string, unknown>): Layout {
  const number = (name: string, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, whole(options[name]) ?? fallback));
  const flag = (name: string, fallback: boolean) => toggle(options[name]) ?? fallback;
  const order = options[LAYOUT.order];
  return {
    columns: number(LAYOUT.columns, LAYOUT_DEFAULTS.columns, 1, LAYOUT_LIMITS.grid),
    rows: number(LAYOUT.rows, LAYOUT_DEFAULTS.rows, 1, LAYOUT_LIMITS.grid),
    order: order === "across" || order === "down" ? order : LAYOUT_DEFAULTS.order,
    repeat: flag(LAYOUT.repeat, LAYOUT_DEFAULTS.repeat),
    fit: flag(LAYOUT.fit, LAYOUT_DEFAULTS.fit),
    rotate: flag(LAYOUT.rotate, LAYOUT_DEFAULTS.rotate),
    margin: number(LAYOUT.margin, LAYOUT_DEFAULTS.margin, 0, LAYOUT_LIMITS.space),
    gap: number(LAYOUT.gap, LAYOUT_DEFAULTS.gap, 0, LAYOUT_LIMITS.space),
    cropMarks: flag(LAYOUT.cropMarks, LAYOUT_DEFAULTS.cropMarks),
    borders: flag(LAYOUT.borders, LAYOUT_DEFAULTS.borders),
  };
}

/**
 * The layout an option map asks for, or null when it leaves each page on a sheet of its own with
 * nothing drawn around it, which is no layout at all.
 */
export function layoutFrom(options: Record<string, unknown>): Layout | null {
  const layout = readLayout(options);
  return layout.columns * layout.rows > 1 || layout.cropMarks || layout.borders ? layout : null;
}

export function withoutLayoutOptions(options: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(options).filter(([name]) => !isLayoutOption(name)));
}

export function sheetCount(pages: number, layout: Layout): number {
  return layout.repeat ? pages : Math.ceil(pages / (layout.columns * layout.rows));
}

/** The document page, counted from 0, that a sheet's cell holds; past the last page the cell stays empty. */
export function pageInCell(sheet: number, cell: number, layout: Layout): number {
  return layout.repeat ? sheet : sheet * layout.columns * layout.rows + cell;
}

/** Where a sheet's nth cell sits, rows counted from the top. */
export function cellPosition(cell: number, layout: Layout): { row: number; column: number } {
  return layout.order === "across"
    ? { row: Math.floor(cell / layout.columns), column: cell % layout.columns }
    : { row: cell % layout.rows, column: Math.floor(cell / layout.rows) };
}

/** The space each page gets on a sheet, in points. */
export function cellSize(sheet: Size, layout: Layout): Size {
  const margin = layout.margin * POINTS_PER_MM;
  const gap = layout.gap * POINTS_PER_MM;
  return {
    width: (sheet.width - margin * 2 - gap * (layout.columns - 1)) / layout.columns,
    height: (sheet.height - margin * 2 - gap * (layout.rows - 1)) / layout.rows,
  };
}

/** Whether the layout turns this page a quarter to suit a cell of that shape. */
export function turnsPage(cell: Size, page: Size, layout: Layout): boolean {
  return layout.rotate && (cell.width > cell.height) !== (page.width > page.height);
}

/** How much of its own size a page could keep in its cell on this sheet. */
function room(sheet: Size, layout: Layout, page: Size): number {
  const cell = cellSize(sheet, layout);
  const [width, height] = turnsPage(cell, page, layout) ? [page.height, page.width] : [page.width, page.height];
  return Math.min(cell.width / width, cell.height / height);
}

/**
 * The paper turned whichever way gives a page more room: two upright pages side by side want the
 * sheet on its side. Printers turn a sideways sheet themselves, as they do for any landscape document.
 */
export function sheetFor(paper: Size, layout: Layout, page: Size): Size {
  const turned = { width: paper.height, height: paper.width };
  return room(turned, layout, page) > room(paper, layout, page) ? turned : paper;
}

/**
 * How much of its own size a page keeps on this paper: 1 when the layout leaves pages alone, and
 * otherwise whatever fills its space, which enlarges a page as readily as it shrinks one.
 */
export function pageScale(paper: Size, layout: Layout, page: Size): number {
  return layout.fit ? room(sheetFor(paper, layout, page), layout, page) : 1;
}

/** Whether the margin and gaps leave any space for pages, whichever way the paper is turned. */
export function hasRoom(paper: Size, layout: Layout): boolean {
  return [paper, { width: paper.height, height: paper.width }].some((sheet) => {
    const cell = cellSize(sheet, layout);
    return cell.width > 0 && cell.height > 0;
  });
}

export interface Placement {
  /** Which of the document's pages this is, counted from 0. */
  page: number;
  /** The page's bottom-left corner, measured from the sheet's, and the size it takes there, in points. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** How much of its own size the page keeps. */
  scale: number;
  /** Turned a quarter to suit its space. */
  turned: boolean;
}

/**
 * Where the pages of one sheet land. `sizes` holds every page of the document as a reader shows it.
 * The server draws from this and the form sketches from it, so the sketch is the sheet in miniature
 * rather than a picture of what it might be.
 */
export function placePages(sheet: Size, layout: Layout, sizes: Size[], sheetIndex: number): Placement[] {
  const { columns, rows } = layout;
  const cell = cellSize(sheet, layout);
  const margin = layout.margin * POINTS_PER_MM;
  const gap = layout.gap * POINTS_PER_MM;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  const placed = [];
  for (let cellIndex = 0; cellIndex < columns * rows; cellIndex++) {
    const page = pageInCell(sheetIndex, cellIndex, layout);
    const size = sizes[page];
    if (!size)
      continue;
    const turned = turnsPage(cell, size, layout);
    placed.push({ page, turned, ...cellPosition(cellIndex, layout), width: turned ? size.height : size.width, height: turned ? size.width : size.height });
  }

  // Fitted, every cell is the same size; at their own size, each column and row is as large as its largest page.
  const widths = Array.from<number>({ length: columns }).fill(layout.fit ? cell.width : 0);
  const heights = Array.from<number>({ length: rows }).fill(layout.fit ? cell.height : 0);
  if (!layout.fit) {
    for (const page of placed) {
      widths[page.column] = Math.max(widths[page.column]!, page.width);
      heights[page.row] = Math.max(heights[page.row]!, page.height);
    }
  }
  const left = margin + Math.max(0, (sheet.width - margin * 2 - sum(widths) - gap * (columns - 1)) / 2);
  const top = margin + Math.max(0, (sheet.height - margin * 2 - sum(heights) - gap * (rows - 1)) / 2);

  return placed.map((page) => {
    const scale = layout.fit ? Math.min(cell.width / page.width, cell.height / page.height) : 1;
    const width = page.width * scale;
    const height = page.height * scale;
    return {
      page: page.page,
      x: left + sum(widths.slice(0, page.column)) + gap * page.column + (widths[page.column]! - width) / 2,
      y: sheet.height - top - sum(heights.slice(0, page.row + 1)) - gap * page.row + (heights[page.row]! - height) / 2,
      width,
      height,
      scale,
      turned: page.turned,
    };
  });
}

/** The layout as a phrase for a summary line: "4 pages per sheet", "2 of each page per sheet with crop marks". */
export function describeLayout(layout: Layout): string {
  const perSheet = layout.columns * layout.rows;
  const marks = [layout.cropMarks ? "crop marks" : "", layout.borders ? "page borders" : ""].filter(Boolean).join(" and ");
  if (perSheet === 1)
    return marks.replace(/^\w/, c => c.toUpperCase());
  const pages = layout.repeat ? `${perSheet} of each page per sheet` : `${perSheet} pages per sheet`;
  return marks ? `${pages} with ${marks}` : pages;
}

/**
 * What a run comes to when every sheet repeats one page, which is where "copies" stops meaning what
 * people need: "40 in total (5 copies \u00D7 8 per sheet)". `pages` is the document's page count where known.
 */
export function describeRun(copies: number, layout: Layout, pages: number | null): string {
  const perSheet = layout.columns * layout.rows;
  const total = `${copies * perSheet} ${pages === 1 ? "in total" : "of each page"}`;
  return `${total} (${copies} ${copies === 1 ? "copy" : "copies"} \u00D7 ${perSheet} per sheet)`;
}

/**
 * The option-map form of how a layout arranges its pages. Crop marks and borders are left out: they
 * are the user's own choice, kept whichever arrangement is picked.
 */
export function arrangementOptions(layout: Layout): Record<string, string | number> {
  return {
    [LAYOUT.columns]: layout.columns,
    [LAYOUT.rows]: layout.rows,
    [LAYOUT.order]: layout.order,
    [LAYOUT.repeat]: String(layout.repeat),
    [LAYOUT.fit]: String(layout.fit),
    [LAYOUT.rotate]: String(layout.rotate),
    [LAYOUT.margin]: layout.margin,
    [LAYOUT.gap]: layout.gap,
  };
}

/** The option-map form of a whole layout, as a form would hold it. */
export function layoutOptions(layout: Layout): Record<string, string | number> {
  return { ...arrangementOptions(layout), [LAYOUT.cropMarks]: String(layout.cropMarks), [LAYOUT.borders]: String(layout.borders) };
}

/**
 * No layout, stated in full. A job's options are laid over its preset's, so leaving the layout out
 * would let a preset's own layout back in: one page per sheet has to be said, not implied.
 */
export const NO_LAYOUT_OPTIONS = layoutOptions(LAYOUT_DEFAULTS);

/** Whether two layouts arrange their pages the same way, marks and borders aside. */
export function sameArrangement(a: Layout, b: Layout): boolean {
  return (Object.keys(a) as Array<keyof Layout>).every(key => key === "cropMarks" || key === "borders" || a[key] === b[key]);
}

/** The everyday arrangements, which suit whatever paper the job is on. Two side by side turn sideways pages to sit one above the other. */
export const PAGES_PER_SHEET: Array<{ id: string; name: string; detail: string; layout: Layout }> = [
  { id: "two", name: "2 pages", detail: "Side by side", layout: { ...LAYOUT_DEFAULTS, columns: 2, rotate: true } },
  { id: "four", name: "4 pages", detail: "Two across, two down", layout: { ...LAYOUT_DEFAULTS, columns: 2, rows: 2 } },
];

/** ISO paper the ready-made layouts are cut from, in millimetres. */
export const ISO_PAPER = { A3: { width: 297, height: 420 } } as const;

/** A ready-made layout for a finished size that is cut from a larger sheet. */
export interface LayoutTemplate {
  id: string;
  name: string;
  /** The paper the grid was worked out for. */
  paper: keyof typeof ISO_PAPER;
  /** The finished piece as it is cut from the sheet, in millimetres. */
  size: Size;
  layout: Layout;
}

/** One page over and over, turned to suit its space. Crop marks stay off, as they are everywhere until asked for. */
function cutApart(columns: number, rows: number, fit: boolean): Layout {
  return { ...LAYOUT_DEFAULTS, columns, rows, fit, repeat: true, rotate: true };
}

/**
 * Eight A6 or six DL fill an A3 sheet exactly, so with a margin and gaps to cut along they come out
 * a little under size; the full-size A6 fits four. Business cards have room to spare and are never
 * resized, which would enlarge them to fill their space.
 */
export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  { id: "a6", name: "A6 cards", paper: "A3", size: { width: 105, height: 148 }, layout: cutApart(2, 4, true) },
  { id: "a6-full-size", name: "A6 cards, full size", paper: "A3", size: { width: 105, height: 148 }, layout: cutApart(2, 2, false) },
  { id: "business-cards", name: "Business cards", paper: "A3", size: { width: 90, height: 55 }, layout: cutApart(2, 5, false) },
  { id: "dl", name: "DL", paper: "A3", size: { width: 99, height: 210 }, layout: cutApart(2, 3, true) },
];

function points(size: Size): Size {
  return { width: size.width * POINTS_PER_MM, height: size.height * POINTS_PER_MM };
}

export function templatePaper(template: LayoutTemplate): Size {
  return points(ISO_PAPER[template.paper]);
}

/** The finished piece a template cuts, in points, for a sketch drawn before any document is chosen. */
export function templatePiece(template: LayoutTemplate): Size {
  return points(template.size);
}

/** How much of its finished size a template's piece keeps on its paper. */
export function templateScale(template: LayoutTemplate): number {
  return pageScale(templatePaper(template), template.layout, points(template.size));
}

/** What a template gives, with its cost in size said outright: "8 per A3, at 96% of full size". */
export function describeTemplate(template: LayoutTemplate): string {
  const perSheet = `${template.layout.columns * template.layout.rows} per ${template.paper}`;
  const scale = Math.round(templateScale(template) * 100);
  if (scale !== 100)
    return `${perSheet}, at ${scale}% of full size`;
  // A name that already promises full size does not need telling twice.
  return /full size/i.test(template.name) ? perSheet : `${perSheet}, full size`;
}
