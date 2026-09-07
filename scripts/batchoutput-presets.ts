import type { PresetExport, PresetExportItem } from "../src/shared/types.js";
/**
 * Converts Zevrix BatchOutput PDF presets into a printmax preset file for the Presets page's
 * Import button. The presets embed Toshiba e-STUDIO PPD features, so the tables below map
 * those PPD codes to the IPP keywords the same printers advertise.
 *
 * Only settings a printer takes over IPP survive: paper size, tray, paper type, duplex, colour,
 * corner staples, orientation and copies. Folding, saddle stitch, booklet imposition and
 * image-quality settings are reported per preset on stderr and in the preset's description.
 *
 * Usage: pnpm batchoutput-presets [presets-dir] > presets.json
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { PRESET_EXPORT_FORMAT } from "../src/shared/types.js";

interface Arg { code?: string; uiStr?: string }
interface Feature { code?: string; uiStr?: string; args?: Arg[]; selectedArg?: string; selectedTitle?: string }
interface Preset {
  name?: string;
  printer?: string;
  copies?: string;
  paperName?: string;
  paperSize?: string;
  orientation?: number;
  pagesPerSheet?: string;
  duplex?: Feature;
  allPagesFrom?: { code?: string };
  printerFeatures?: { groups?: Array<{ features?: Record<string, Feature> }> };
}

const DEFAULT_DIR = path.join(homedir(), "Library/Application Support/Zevrix/BatchOutput PDF/Presets");

const PAPER_SIZES_MM: Array<[string, number, number]> = [
  ["iso_a3_297x420mm", 297, 420],
  ["iso_a4_210x297mm", 210, 297],
  ["iso_a5_148x210mm", 148, 210],
  ["iso_a6_105x148mm", 105, 148],
  ["iso_dl_110x220mm", 110, 220],
  ["iso_c5_162x229mm", 162, 229],
  ["iso_sra3_320x450mm", 320, 450],
  ["jis_b4_257x364mm", 257, 364],
  ["jis_b5_182x257mm", 182, 257],
  ["om_folio_210x330mm", 210, 330],
  ["na_letter_8.5x11in", 215.9, 279.4],
  ["na_legal_8.5x14in", 215.9, 355.6],
  ["na_ledger_11x17in", 279.4, 431.8],
];

const DUPLEX: Record<string, string> = { None: "one-sided", DuplexNoTumble: "two-sided-long-edge", DuplexTumble: "two-sided-short-edge" };
const TRAYS: Record<string, string> = { Drawer1: "tray-1", Drawer2: "tray-2", Drawer3: "tray-3", SheetFeedBypass: "by-pass-tray" };
const COLOUR: Record<string, string> = { "Auto": "auto", "Color": "color", "Mono": "monochrome", "Black&White": "monochrome" };
const STAPLES: Record<string, string> = { None: "none", UL: "staple-top-left", LL: "staple-bottom-left", ML: "staple-dual-left", MT: "staple-dual-top" };
const MEDIA_TYPES: Record<string, string> = {
  Plainthin: "stationery-lightweight",
  Plain: "stationery",
  Plain1: "stationery",
  Plain2: "stationery",
  Thick: "jp.co.toshibatec.thick",
  Thick1: "stationery-heavyweight",
  Thick2: "jp.co.toshibatec.thick2",
  Thick3: "jp.co.toshibatec.thick3",
  Thick4: "jp.co.toshibatec.thick4",
  Transparency: "transparency",
  Recycled: "jp.co.toshibatec.recycled",
  Special1: "jp.co.toshibatec.special1",
  Special2: "jp.co.toshibatec.special2",
  Special3: "jp.co.toshibatec.special3",
  Envelope: "envelope",
};

interface Selection { code: string; label: string; feature: string }

interface Converted {
  preset: PresetExportItem;
  /** Settings the printer cannot take over IPP; these go into the description. */
  lost: string[];
  /** Image-quality and layout tweaks silently left behind. */
  ignored: string[];
}

function readPreset(file: string): Preset {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" })) as Preset;
}

function paperSize(spec: string | undefined): string | undefined {
  const m = /\{\s*([\d.]+),\s*([\d.]+)\s*\}/.exec(spec ?? "");
  if (!m)
    return undefined;
  const [w, h] = [Number(m[1]), Number(m[2])].map(pt => pt * 25.4 / 72).sort((a, b) => a - b) as [number, number];
  return PAPER_SIZES_MM.find(([, pw, ph]) => Math.abs(pw - w) < 1.5 && Math.abs(ph - h) < 1.5)?.[0];
}

function duplexFromTitle(title: string | undefined): string {
  if (!title || /1-Sided/i.test(title))
    return "None";
  return /No Tumble/i.test(title) ? "DuplexNoTumble" : "DuplexTumble";
}

/** Every PPD feature the preset sets away from its default, keyed by PPD option name. */
function selections(p: Preset): Map<string, Selection> {
  const out = new Map<string, Selection>();
  for (const group of p.printerFeatures?.groups ?? []) {
    for (const [key, f] of Object.entries(group.features ?? {})) {
      const sel = f.selectedArg;
      if (!sel || sel === "default")
        continue;
      const code = sel.startsWith(`${f.code ?? key}=`) ? sel.slice((f.code ?? key).length + 1) : sel;
      const label = f.args?.find(a => a.code === code)?.uiStr ?? code;
      out.set(key, { code, label, feature: f.uiStr ?? key });
    }
  }
  return out;
}

function convert(p: Preset): Converted | null {
  if (!p.name)
    return null;
  const options: Record<string, unknown> = {};
  const lost: string[] = [];
  const ignored: string[] = [];
  const chosen = selections(p);

  const take = (key: string, attribute: string, map: (code: string) => unknown, what: string) => {
    const s = chosen.get(key);
    chosen.delete(key);
    if (!s)
      return;
    const value = map(s.code);
    if (value === undefined)
      lost.push(`${what} ${s.label.replace(/\s*\(.*$/, "")}`);
    else if (value !== null)
      options[attribute] = value;
  };

  const media = paperSize(p.paperSize);
  if (media)
    options.media = media;
  else if (p.paperName)
    lost.push(`paper size ${p.paperName}`);
  if (p.orientation === 1)
    options["orientation-requested"] = "landscape";
  const copies = Number(p.copies);
  if (Number.isInteger(copies) && copies > 1)
    options.copies = copies;
  if (p.pagesPerSheet && p.pagesPerSheet !== "1")
    lost.push(`${p.pagesPerSheet} pages per sheet`);

  const duplex = chosen.get("Duplex")?.code ?? duplexFromTitle(p.duplex?.selectedTitle);
  chosen.delete("Duplex");
  options.sides = DUPLEX[duplex] ?? "one-sided";

  const slot = chosen.get("InputSlot")?.code ?? p.allPagesFrom?.code;
  chosen.delete("InputSlot");
  if (slot && slot !== "AutoSelect" && slot !== "Auto") {
    if (TRAYS[slot])
      options["media-source"] = TRAYS[slot];
    else
      lost.push(`tray ${slot}`);
  }

  take("MediaType", "media-type", code => code === "None" ? null : MEDIA_TYPES[code], "paper type");
  take("ColorType", "print-color-mode", code => COLOUR[code], "colour");

  const staple = chosen.get("Stapling");
  chosen.delete("Stapling");
  if (staple && staple.code !== "None") {
    if (staple.code === "SS")
      lost.push("saddle stitch");
    else if (STAPLES[staple.code])
      options.finishings = [STAPLES[staple.code]];
    else
      lost.push(`staple ${staple.label.replace(/\s*\(.*$/, "")}`);
  }

  const drop = (key: string, describe: (s: Selection) => string | null) => {
    const s = chosen.get(key);
    chosen.delete(key);
    const text = s ? describe(s) : null;
    if (text)
      lost.push(text);
  };
  drop("Folding", s => s.code === "True" ? "fold" : null);
  drop("BookletPaperSize", s => s.code === "None" ? null : `booklet on ${s.label}`);
  drop("Resolution", s => s.label);
  drop("UseFrontCover", s => s.code === "True" ? "front cover" : null);
  drop("UseBackCover", s => s.code === "True" ? "back cover" : null);

  for (const s of chosen.values())
    ignored.push(`${s.feature}: ${s.label}`);

  const description = lost.length > 0 ? `Not carried over from BatchOutput PDF: ${lost.join(", ")}.` : null;
  return { preset: { name: p.name, description, scope: "global", options }, lost, ignored };
}

function main(): void {
  const dir = process.argv[2] ?? DEFAULT_DIR;
  const files = readdirSync(dir).filter(f => f.endsWith(".xml")).sort();
  if (files.length === 0) {
    console.error(`no presets found in ${dir}`);
    process.exit(2);
  }
  const converted: Converted[] = [];
  let printer: string | undefined;
  for (const file of files) {
    const p = readPreset(path.join(dir, file));
    printer ??= p.printer;
    const c = convert(p);
    if (!c) {
      console.error(`skipping ${file}: no preset name`);
      continue;
    }
    converted.push(c);
    console.error(c.preset.name);
    console.error(`  ${Object.entries(c.preset.options).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("+") : String(v)}`).join("  ")}`);
    if (c.lost.length > 0)
      console.error(`  not carried over: ${c.lost.join(", ")}`);
    if (c.ignored.length > 0)
      console.error(`  ignored: ${c.ignored.join("; ")}`);
  }
  const out: PresetExport = {
    format: PRESET_EXPORT_FORMAT,
    printer: { name: printer ?? "BatchOutput PDF", makeModel: null },
    presets: converted.map(c => c.preset),
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  console.error(`\n${converted.length} presets written. Import the file from the Presets page.`);
}

main();
