import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { toDto as toJobDto } from "../jobs.js";
import { createGroup, deleteGroup, listGroups, renameGroup, reorderGroups, toLibraryGroupDto } from "../library-groups.js";
import { createStoredJob, deleteStoredJob, listStoredJobs, printStoredJob, replaceStoredFile, storeFromJob, toStoredJobDto, updateStoredJob } from "../library.js";
import { idParam } from "./params.js";
import { optionsField, receiveUpload, removeQuietly } from "./upload.js";

export function libraryRoutes(app: FastifyInstance, db: Db, dirs: { storedDir: string; uploadDir: string }): void {
  app.get("/api/library", async (req) => {
    const raw = (req.query as { printerId?: string }).printerId;
    const printerId = raw === undefined ? undefined : Number(raw);
    if (printerId !== undefined && !Number.isInteger(printerId))
      throw new HttpError(400, "invalid printerId");
    return listStoredJobs(db, req.user!, printerId).map(row => toStoredJobDto(db, row, req.user!));
  });

  app.get("/api/library/groups", async (req) => {
    const printerId = Number((req.query as { printerId?: string }).printerId);
    if (!Number.isInteger(printerId))
      throw new HttpError(400, "printerId is required");
    return listGroups(db, printerId).map(row => toLibraryGroupDto(db, row, req.user!));
  });

  app.post("/api/library/groups", async (req, reply) => {
    const body = (req.body ?? {}) as { printerId?: unknown; name?: unknown };
    const row = createGroup(db, { printerId: body.printerId, name: body.name }, req.user!);
    return reply.code(201).send(toLibraryGroupDto(db, row, req.user!));
  });

  /** The whole order at once: the page knows the list it is reordering. */
  app.put("/api/library/groups/order", async (req) => {
    const body = (req.body ?? {}) as { printerId?: unknown; ids?: unknown };
    return reorderGroups(db, { printerId: body.printerId, ids: body.ids }, req.user!).map(row => toLibraryGroupDto(db, row, req.user!));
  });

  app.put("/api/library/groups/:id", async (req) => {
    const body = (req.body ?? {}) as { name?: unknown };
    const row = renameGroup(db, idParam(req.params), { name: body.name }, req.user!);
    return toLibraryGroupDto(db, row, req.user!);
  });

  app.delete("/api/library/groups/:id", async (req, reply) => {
    deleteGroup(db, idParam(req.params), req.user!);
    return reply.code(204).send();
  });

  /** Multipart: the file plus name, printerId, optional presetId, groupId, scope and options (JSON). */
  app.post("/api/library", async (req, reply) => {
    const upload = await receiveUpload(req, dirs.storedDir);
    try {
      const f = upload.fields;
      const row = createStoredJob(db, { printerId: f.printerId, presetId: f.presetId, name: f.name, groupId: f.groupId, scope: f.scope, options: optionsField(f.options) }, { filePath: upload.filePath, filename: upload.filename, byteSize: upload.byteSize, format: upload.format }, req.user!);
      return reply.code(201).send(toStoredJobDto(db, row, req.user!));
    }
    catch (err) {
      await removeQuietly(upload.filePath);
      throw err;
    }
  });

  app.post("/api/library/from-job/:jobId", async (req, reply) => {
    const body = (req.body ?? {}) as { name?: unknown; scope?: unknown };
    const row = await storeFromJob(db, idParam(req.params, "jobId"), { name: body.name, scope: body.scope }, req.user!, dirs.storedDir);
    return reply.code(201).send(toStoredJobDto(db, row, req.user!));
  });

  app.put("/api/library/:id", async (req) => {
    const body = (req.body ?? {}) as { name?: unknown; presetId?: unknown; groupId?: unknown; scope?: unknown; options?: unknown };
    const row = updateStoredJob(db, idParam(req.params), { name: body.name, presetId: body.presetId, groupId: body.groupId, scope: body.scope, options: body.options }, req.user!);
    return toStoredJobDto(db, row, req.user!);
  });

  app.put("/api/library/:id/file", async (req) => {
    const upload = await receiveUpload(req, dirs.storedDir);
    try {
      const row = await replaceStoredFile(db, idParam(req.params), { filePath: upload.filePath, filename: upload.filename, byteSize: upload.byteSize, format: upload.format }, req.user!);
      return toStoredJobDto(db, row, req.user!);
    }
    catch (err) {
      await removeQuietly(upload.filePath);
      throw err;
    }
  });

  app.post("/api/library/:id/print", async (req, reply) => {
    const body = (req.body ?? {}) as { copies?: unknown };
    const job = await printStoredJob(db, idParam(req.params), { copies: body.copies }, req.user!, dirs.uploadDir);
    return reply.code(201).send(toJobDto(db, job));
  });

  app.delete("/api/library/:id", async (req, reply) => {
    await deleteStoredJob(db, idParam(req.params), req.user!);
    return reply.code(204).send();
  });
}
