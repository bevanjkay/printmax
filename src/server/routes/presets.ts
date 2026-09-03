import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { canUsePreset, createPreset, deletePreset, listPresetsFor, requirePreset, toPresetDto, updatePreset } from "../presets.js";
import { idParam } from "./params.js";

export function presetRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/presets", async (req) => {
    const printerId = (req.query as { printerId?: string }).printerId;
    const id = printerId === undefined ? undefined : Number(printerId);
    if (id !== undefined && !Number.isInteger(id))
      throw new HttpError(400, "invalid printerId");
    return listPresetsFor(db, req.user!, id).map(p => toPresetDto(db, p, req.user!));
  });

  app.get("/api/presets/:id", async (req) => {
    const preset = requirePreset(db, idParam(req.params));
    if (!canUsePreset(preset, req.user!))
      throw new HttpError(404, "preset not found");
    return toPresetDto(db, preset, req.user!);
  });

  app.post("/api/presets", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const preset = createPreset(db, { printerId: body.printerId, name: body.name, description: body.description, scope: body.scope, options: body.options }, req.user!);
    return reply.code(201).send(toPresetDto(db, preset, req.user!));
  });

  app.put("/api/presets/:id", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const preset = updatePreset(db, idParam(req.params), { printerId: body.printerId, name: body.name, description: body.description, scope: body.scope, options: body.options }, req.user!);
    return toPresetDto(db, preset, req.user!);
  });

  app.delete("/api/presets/:id", async (req, reply) => {
    deletePreset(db, idParam(req.params), req.user!);
    return reply.code(204).send();
  });
}
