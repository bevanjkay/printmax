import type { FastifyRequest } from "fastify";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { HttpError } from "../errors.js";
import { sniffFormat, SUPPORTED_FORMATS } from "../format.js";

export interface ReceivedUpload {
  filePath: string;
  filename: string;
  byteSize: number;
  format: string;
  /** The other multipart fields, as strings. */
  fields: Record<string, string>;
}

async function readHead(file: string, bytes = 16): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  }
  finally {
    await handle.close();
  }
}

export async function removeQuietly(file: string): Promise<void> {
  try {
    await unlink(file);
  }
  catch {
    // best effort
  }
}

/**
 * Streams the one file of a multipart request into `dir` under a random name, identifies its
 * format from its bytes, and collects the other fields. On any refusal the file is removed.
 */
export async function receiveUpload(req: FastifyRequest, dir: string): Promise<ReceivedUpload> {
  if (!req.isMultipart())
    throw new HttpError(400, "expected multipart/form-data with a file");

  const fields: Record<string, string> = {};
  let saved: { tempPath: string; filename: string; byteSize: number; truncated: boolean } | undefined;

  for await (const part of req.parts()) {
    if (part.type === "file") {
      if (saved) {
        part.file.resume();
        continue;
      }
      const tempPath = path.join(dir, `${randomUUID()}.upload`);
      let byteSize = 0;
      part.file.on("data", (chunk: Buffer) => {
        byteSize += chunk.length;
      });
      await pipeline(part.file, createWriteStream(tempPath));
      saved = { tempPath, filename: path.basename(part.filename || "document"), byteSize, truncated: part.file.truncated };
    }
    else {
      fields[part.fieldname] = String(part.value);
    }
  }

  if (!saved)
    throw new HttpError(400, "no file uploaded");
  const discard = async (status: number, message: string): Promise<never> => {
    await removeQuietly(saved!.tempPath);
    throw new HttpError(status, message);
  };
  if (saved.truncated)
    await discard(413, "file exceeds the upload size limit");
  const sniffed = sniffFormat(await readHead(saved.tempPath));
  if (!sniffed)
    await discard(415, `unrecognised file type; upload one of ${SUPPORTED_FORMATS.join(", ")}`);
  const filePath = saved.tempPath.replace(/\.upload$/, sniffed!.extension);
  await rename(saved.tempPath, filePath);
  return { filePath, filename: saved.filename, byteSize: saved.byteSize, format: sniffed!.format, fields };
}

/** Parses the JSON `options` field of an upload; an empty field means no options. */
export function optionsField(raw: string | undefined): Record<string, unknown> {
  if (!raw)
    return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new TypeError("not an object");
    return parsed as Record<string, unknown>;
  }
  catch {
    throw new HttpError(400, "options must be a JSON object");
  }
}
