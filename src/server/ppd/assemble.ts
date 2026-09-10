/**
 * Builds the job the printer's own driver would send: a JCL (PJL) wrapper around PostScript
 * whose setup section applies every PPD option, chosen or default, in *OrderDependency order.
 * The shape mirrors what CUPS emits so vendor snippets see the state they expect.
 */
import type { ParsedPpd, PpdOption } from "./parser.js";
import { Buffer } from "node:buffer";
import { overriddenDefaults } from "./form.js";

/** Every option resolved to the chosen choice or its default; options with neither are omitted. */
export function effectiveChoices(ppd: ParsedPpd, chosen: Record<string, string>): Array<{ option: PpdOption; value: string }> {
  const dropped = overriddenDefaults(ppd, chosen);
  const out: Array<{ option: PpdOption; value: string }> = [];
  const pageSize = ppd.options.find(o => o.key === "PageSize");
  const pageSizeValue = pageSize ? chosen.PageSize ?? pageSize.default : null;
  for (const option of ppd.options) {
    let value = chosen[option.key] ?? (dropped.has(option.key) ? null : option.default);
    // PageRegion follows PageSize, as a driver marks them together.
    if (option.key === "PageRegion" && pageSizeValue && option.choices.some(c => c.value === pageSizeValue))
      value = pageSizeValue;
    if (value !== null && value !== undefined && option.choices.some(c => c.value === value))
      out.push({ option, value });
  }
  return out;
}

function feature(option: PpdOption, value: string): string {
  const code = option.choices.find(c => c.value === value)?.code ?? "";
  return `[{\n%%BeginFeature: *${option.key} ${value}\n${code ? `${code}\n` : ""}%%EndFeature\n} stopped cleartomark\n`;
}

/** The %%BeginSetup block: patch files first, then non-JCL options by order, alphabetical within equal orders (CUPS's sort). */
export function setupBlock(ppd: ParsedPpd, chosen: Record<string, string>): string {
  const patches = ppd.jobPatchFiles.map(p => `[{\n%%BeginFeature: *JobPatchFile ${p.name}\n${p.code}\n%%EndFeature\n} stopped cleartomark\n`).join("");
  const picked = effectiveChoices(ppd, chosen)
    .filter(c => c.option.section !== "JCLSetup")
    .sort((a, b) => a.option.order - b.option.order || (a.option.key < b.option.key ? -1 : a.option.key > b.option.key ? 1 : 0));
  return patches + picked.map(c => feature(c.option, c.value)).join("");
}

function pjlString(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "").replace(/"/g, "'").slice(0, 80);
}

/** PJL header. CUPS replaces a bare "@PJL JOB" with a named job line and adds the user; so do we. */
export function jclHeader(ppd: ParsedPpd, chosen: Record<string, string>, jobName: string, userName: string): string {
  if (!ppd.jcl)
    return "";
  const lines = ppd.jcl.begin.split("\n").filter(l => l.length > 0);
  const isPjl = lines.some(l => l.includes("@PJL"));
  let out = "";
  for (const line of lines)
    out += `${line.replace(/@PJL JOB\s*$/, "@PJL")}\n`;
  if (isPjl)
    out += `@PJL JOB NAME = "${pjlString(jobName)}"\n@PJL SET USERNAME = "${pjlString(userName)}"\n`;
  for (const { option, value } of effectiveChoices(ppd, chosen)) {
    if (option.section === "JCLSetup") {
      const code = option.choices.find(c => c.value === value)?.code;
      if (code)
        out += `${code}\n`;
    }
  }
  return out + ppd.jcl.toPs;
}

export interface AssembleInput {
  ppd: ParsedPpd;
  chosen: Record<string, string>;
  jobName: string;
  userName: string;
  /** DSC-conforming PostScript for the document, as Ghostscript's ps2write produces. */
  document: Buffer;
}

/** Where a DSC comment opens a line, which is the only place it means anything. */
function lineStarting(document: Buffer, marker: string): number {
  if (document.subarray(0, marker.length).toString("latin1") === marker)
    return 0;
  const at = document.indexOf(`\n${marker}`, 0, "latin1");
  return at < 0 ? -1 : at + 1;
}

/**
 * Inserts the setup block before the first page, after any prolog the converter wrote. The document
 * is spliced as bytes: a booklet's PostScript is far too large to pass through a JavaScript string.
 */
export function assemblePostScript(input: AssembleInput): Buffer {
  const { document } = input;
  const setup = Buffer.from(`%%BeginSetup\n${setupBlock(input.ppd, input.chosen)}%%EndSetup\n`, "latin1");
  const header = Buffer.from(jclHeader(input.ppd, input.chosen, input.jobName, input.userName), "latin1");
  const trailer = Buffer.from(input.ppd.jcl?.end ?? "", "latin1");
  let at = -1;
  for (const marker of ["%%Page:", "%%Trailer"]) {
    at = lineStarting(document, marker);
    if (at >= 0)
      break;
  }
  return at < 0
    ? Buffer.concat([header, document, setup, trailer])
    : Buffer.concat([header, document.subarray(0, at), setup, document.subarray(at), trailer]);
}
