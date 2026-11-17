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
 * The layout an option map asks for, or null when it leaves each page on a sheet of its own with
 * nothing drawn around it, which is no layout at all. Anything unreadable falls back to its default,
 * so a form can ask while a value is half typed; `layoutErrors` is what refuses a job.
 */
export function layoutFrom(options: Record<string, unknown>): Layout | null {
  const number = (name: string, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, whole(options[name]) ?? fallback));
  const flag = (name: string, fallback: boolean) => toggle(options[name]) ?? fallback;
  const order = options[LAYOUT.order];
  const layout: Layout = {
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

/** Whether the margin and gaps leave any space for pages, whichever way the paper is turned. */
export function hasRoom(paper: Size, layout: Layout): boolean {
  return [paper, { width: paper.height, height: paper.width }].some((sheet) => {
    const cell = cellSize(sheet, layout);
    return cell.width > 0 && cell.height > 0;
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
