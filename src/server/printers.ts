import type { PrinterDto, PrinterSummary } from "../shared/types.js";
import type { Db } from "./db.js";
import type { PrinterTarget } from "./ipp/client.js";
import type { IppAttributes, IppValue } from "./ipp/codec.js";
import { now } from "./db.js";
import { HttpError, notFound } from "./errors.js";
import { IppStatusError, IppTransportError, toHttpUrl } from "./ipp/client.js";
import { attrValue, attrValues } from "./ipp/codec.js";
import { enumName } from "./ipp/enums.js";
import { getPrinterAttributes } from "./ipp/operations.js";
import { mergeCaps } from "./ipp/options.js";

export interface PrinterRow {
  id: number;
  name: string;
  uri: string;
  username: string | null;
  password: string | null;
  uuid: string | null;
  make_model: string | null;
  location: string | null;
  caps_discovered: string;
  caps_overrides: string;
  caps_fetched_at: string | null;
  created_at: string;
}

export function targetFor(printer: PrinterRow): PrinterTarget {
  return { uri: printer.uri, username: printer.username, password: printer.password };
}

export function capsFor(printer: PrinterRow): IppAttributes {
  return mergeCaps(JSON.parse(printer.caps_discovered) as IppAttributes, JSON.parse(printer.caps_overrides) as IppAttributes);
}

export function listPrinters(db: Db): PrinterRow[] {
  return db.prepare("SELECT * FROM printers ORDER BY name").all() as unknown as PrinterRow[];
}

export function getPrinter(db: Db, id: number): PrinterRow | undefined {
  return db.prepare("SELECT * FROM printers WHERE id = ?").get(id) as unknown as PrinterRow | undefined;
}

export function requirePrinter(db: Db, id: number): PrinterRow {
  const p = getPrinter(db, id);
  if (!p)
    throw notFound("printer");
  return p;
}

async function fetchCaps(target: PrinterTarget): Promise<IppAttributes> {
  try {
    return await getPrinterAttributes(target);
  }
  catch (err) {
    if (err instanceof IppTransportError)
      throw new HttpError(502, `could not reach printer: ${err.message}`);
    if (err instanceof IppStatusError)
      throw new HttpError(502, `printer rejected Get-Printer-Attributes: ${err.message}`);
    throw err;
  }
}

export interface AddPrinterInput {
  name?: string;
  uri: string;
  username?: string | null;
  password?: string | null;
}

export async function addPrinter(db: Db, input: AddPrinterInput): Promise<PrinterRow> {
  const uri = input.uri.trim();
  try {
    toHttpUrl(uri);
  }
  catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
  if (db.prepare("SELECT 1 FROM printers WHERE uri = ?").get(uri))
    throw new HttpError(409, "a printer with that URI already exists");

  const target: PrinterTarget = { uri, username: input.username ?? null, password: input.password ?? null };
  const caps = await fetchCaps(target);
  const name = input.name?.trim() || attrValue<string>(caps, "printer-name") || attrValue<string>(caps, "printer-make-and-model") || uri;
  const timestamp = now();
  const result = db.prepare(`
    INSERT INTO printers (name, uri, username, password, uuid, make_model, location, caps_discovered, caps_fetched_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    uri,
    target.username ?? null,
    target.password ?? null,
    attrValue<string>(caps, "printer-uuid") ?? null,
    attrValue<string>(caps, "printer-make-and-model") ?? null,
    attrValue<string>(caps, "printer-location") ?? null,
    JSON.stringify(caps),
    timestamp,
    timestamp,
  );
  return requirePrinter(db, Number(result.lastInsertRowid));
}

export async function refreshPrinter(db: Db, id: number): Promise<PrinterRow> {
  const printer = requirePrinter(db, id);
  const caps = await fetchCaps(targetFor(printer));
  db.prepare(`
    UPDATE printers SET caps_discovered = ?, caps_fetched_at = ?, uuid = COALESCE(?, uuid), make_model = COALESCE(?, make_model), location = COALESCE(?, location)
    WHERE id = ?
  `).run(
    JSON.stringify(caps),
    now(),
    attrValue<string>(caps, "printer-uuid") ?? null,
    attrValue<string>(caps, "printer-make-and-model") ?? null,
    attrValue<string>(caps, "printer-location") ?? null,
    id,
  );
  return requirePrinter(db, id);
}

export function deletePrinter(db: Db, id: number): void {
  requirePrinter(db, id);
  db.prepare("DELETE FROM printers WHERE id = ?").run(id);
}

function labelled(caps: IppAttributes, name: string): string[] {
  return attrValues<IppValue>(caps, name).map(v => typeof v === "number" ? enumName(name, v) : String(v));
}

export function summarise(caps: IppAttributes): PrinterSummary {
  const state = attrValue<number>(caps, "printer-state");
  const defaults: Record<string, string | number> = {};
  for (const key of ["sides", "print-color-mode", "media", "copies", "print-quality", "finishings", "output-bin", "media-source"]) {
    const v = attrValue<IppValue>(caps, `${key}-default`);
    if (typeof v === "number")
      defaults[key] = key === "copies" ? v : enumName(key, v);
    else if (typeof v === "string")
      defaults[key] = v;
  }
  return {
    state: state === undefined ? "unknown" : enumName("printer-state", state),
    stateReasons: attrValues<string>(caps, "printer-state-reasons").filter(r => r !== "none"),
    documentFormats: attrValues<string>(caps, "document-format-supported"),
    sides: labelled(caps, "sides-supported"),
    colorModes: labelled(caps, "print-color-mode-supported"),
    media: labelled(caps, "media-supported"),
    mediaSources: labelled(caps, "media-source-supported"),
    finishings: labelled(caps, "finishings-supported"),
    outputBins: labelled(caps, "output-bin-supported"),
    printQuality: labelled(caps, "print-quality-supported"),
    copiesMax: (attrValue<{ min: number; max: number }>(caps, "copies-supported"))?.max ?? 1,
    jobCreationAttributes: attrValues<string>(caps, "job-creation-attributes-supported"),
    jobAccountIdSupported: attrValue<boolean>(caps, "job-account-id-supported") ?? false,
    defaults,
  };
}

export function toDto(printer: PrinterRow): PrinterDto {
  return {
    id: printer.id,
    name: printer.name,
    uri: printer.uri,
    hasCredentials: Boolean(printer.username),
    uuid: printer.uuid,
    makeModel: printer.make_model,
    location: printer.location,
    capsFetchedAt: printer.caps_fetched_at,
    createdAt: printer.created_at,
    summary: summarise(capsFor(printer)),
  };
}
