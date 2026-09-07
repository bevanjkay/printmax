import type { ProbeResult } from "../shared/types.js";
import type { IppAttributes, IppValue } from "./ipp/codec.js";
import type { PrinterRow } from "./printers.js";
import { enumName } from "../shared/enums.js";
import { HttpError } from "./errors.js";
import { IppTransportError } from "./ipp/client.js";
import { attrValues, isOutOfBand } from "./ipp/codec.js";
import { validateJob } from "./ipp/operations.js";
import { buildJobAttributes } from "./ipp/options.js";
import { capsFor, targetFor } from "./printers.js";

function describe(name: string, v: IppValue): string {
  if (typeof v === "number")
    return enumName(name, v);
  return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
}

function describeUnsupported(attrs: IppAttributes): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, attr] of Object.entries(attrs))
    out[name] = isOutOfBand(attr.type) ? "not supported" : attr.values.map(v => describe(name, v)).join(", ");
  return out;
}

/** Sends the options to the printer as a Validate-Job, the only way to test a value it did not advertise. */
export async function probeOptions(printer: PrinterRow, options: Record<string, unknown>, userName: string): Promise<ProbeResult> {
  const caps = capsFor(printer);
  let jobAttributes: IppAttributes;
  try {
    jobAttributes = buildJobAttributes(options, caps);
  }
  catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
  const formats = attrValues<string>(caps, "document-format-supported");
  const documentFormat = formats.includes("application/pdf") ? "application/pdf" : formats[0] ?? "application/octet-stream";
  try {
    const result = await validateJob(
      { ...targetFor(printer), timeoutMs: 10_000 },
      { documentFormat, jobName: "printmax check", requestingUserName: userName, jobAttributes },
    );
    return { accepted: result.accepted, status: result.status, message: result.message, unsupported: describeUnsupported(result.unsupported) };
  }
  catch (err) {
    if (err instanceof IppTransportError)
      throw new HttpError(502, `printer not reachable: ${err.message}`);
    throw err;
  }
}
