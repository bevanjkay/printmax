import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import { HttpError, notFound } from "../errors.js";
import { cancelJob, canSeeJob, createJob, listJobs, reprintJob, requireJob, toDto } from "../jobs.js";
import { idParam } from "./params.js";
import { optionsField, receiveUpload, removeQuietly } from "./upload.js";

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
    const upload = await receiveUpload(req, uploadDir);
    try {
      const printerId = Number(upload.fields.printerId);
      if (!Number.isInteger(printerId) || printerId <= 0)
        throw new HttpError(400, "printerId is required");
      const presetId = upload.fields.presetId ? Number(upload.fields.presetId) : null;
      if (presetId !== null && !Number.isInteger(presetId))
        throw new HttpError(400, "invalid presetId");
      const job = createJob(db, {
        printerId,
        user: req.user!,
        presetId,
        filename: upload.filename,
        filePath: upload.filePath,
        byteSize: upload.byteSize,
        documentFormat: upload.format,
        options: optionsField(upload.fields.options),
      });
      return reply.code(201).send(toDto(db, job));
    }
    catch (err) {
      await removeQuietly(upload.filePath);
      throw err;
    }
  });

  app.post("/api/jobs/:id/reprint", async (req, reply) => {
    const body = (req.body ?? {}) as { copies?: unknown };
    const job = await reprintJob(db, idParam(req.params), req.user!, { copies: body.copies });
    return reply.code(201).send(toDto(db, job));
  });

  app.post("/api/jobs/:id/cancel", async (req) => {
    const job = await cancelJob(db, idParam(req.params), req.user!);
    return toDto(db, job);
  });
}
