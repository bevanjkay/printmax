import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { HttpError, notFound } from "../errors.js";
import { sniffFormat, SUPPORTED_FORMATS } from "../format.js";
import { cancelJob, canSeeJob, createJob, listJobs, requireJob, toDto } from "../jobs.js";
import { idParam } from "./params.js";

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

async function removeQuietly(file: string): Promise<void> {
  try {
    await unlink(file);
  }
  catch {
    // best effort
  }
}

export function jobRoutes(app: FastifyInstance, db: Db, uploadDir: string): void {
  app.get("/api/jobs", async (req) => {
    const query = req.query as { limit?: string; all?: string };
    const limit = Math.min(Number(query.limit ?? 100) || 100, 500);
    const user = req.user!;
    const everyone = user.role === "admin" && query.all === "true";
    return listJobs(db, { limit, ...(everyone ? {} : { userId: user.id }) }).map(job => toDto(db, job));
  });

  app.get("/api/jobs/:id", async (req) => {
    const job = requireJob(db, idParam(req.params));
    if (!canSeeJob(job, req.user!))
      throw notFound("job");
    return toDto(db, job);
  });

  app.post("/api/jobs", async (req, reply) => {
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
        const tempPath = path.join(uploadDir, `${randomUUID()}.upload`);
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

    const printerId = Number(fields.printerId);
    if (!Number.isInteger(printerId) || printerId <= 0)
      await discard(400, "printerId is required");
    const presetId = fields.presetId ? Number(fields.presetId) : null;
    if (presetId !== null && !Number.isInteger(presetId))
      await discard(400, "invalid presetId");

    let options: Record<string, unknown> = {};
    try {
      options = fields.options ? JSON.parse(fields.options) as Record<string, unknown> : {};
      if (typeof options !== "object" || options === null || Array.isArray(options))
        throw new TypeError("not an object");
    }
    catch {
      await discard(400, "options must be a JSON object");
    }

    const sniffed = sniffFormat(await readHead(saved.tempPath));
    if (!sniffed)
      await discard(415, `unrecognised file type; upload one of ${SUPPORTED_FORMATS.join(", ")}`);
    const finalPath = saved.tempPath.replace(/\.upload$/, sniffed!.extension);
    await rename(saved.tempPath, finalPath);

    try {
      const job = createJob(db, {
        printerId,
        user: req.user!,
        presetId,
        filename: saved.filename,
        filePath: finalPath,
        byteSize: saved.byteSize,
        documentFormat: sniffed!.format,
        options,
      });
      return reply.code(201).send(toDto(db, job));
    }
    catch (err) {
      await removeQuietly(finalPath);
      throw err;
    }
  });

  app.post("/api/jobs/:id/cancel", async (req) => {
    const job = await cancelJob(db, idParam(req.params), req.user!);
    return toDto(db, job);
  });
}
