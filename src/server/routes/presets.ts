import type { FastifyInstance } from "fastify";
import type { PresetExport, PresetImportResult } from "../../shared/types.js";
import type { Db } from "../db.js";
import { PRESET_EXPORT_FORMAT } from "../../shared/types.js";
import { HttpError } from "../errors.js";
import { canUsePreset, createPreset, deletePreset, exportPresets, importPresets, listPresetsFor, requirePreset, toPresetDto, updatePreset } from "../presets.js";
import { requirePrinter } from "../printers.js";
import { idParam } from "./params.js";

function printerIdFrom(value: unknown): number {
  const id = Number(value);
  if (value === undefined || value === "" || !Number.isInteger(id))
    throw new HttpError(400, "printerId is required");
  return id;
}

export function presetRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/presets", async (req) => {
    const printerId = (req.query as { printerId?: string }).printerId;
    const id = printerId === undefined ? undefined : Number(printerId);
    if (id !== undefined && !Number.isInteger(id))
      throw new HttpError(400, "invalid printerId");
    return listPresetsFor(db, req.user!, id).map(p => toPresetDto(db, p, req.user!));
  });

  app.get("/api/presets/export", async (req) => {
    const printerId = printerIdFrom((req.query as { printerId?: string }).printerId);
    const printer = requirePrinter(db, printerId);
    const file: PresetExport = {
      format: PRESET_EXPORT_FORMAT,
      printer: { name: printer.name, makeModel: printer.make_model },
      presets: exportPresets(db, printerId, req.user!),
    };
    return file;
  });

  app.post("/api/presets/import", async (req) => {
    const body = (req.body ?? {}) as { printerId?: unknown; presets?: unknown };
    const printerId = printerIdFrom(body.printerId);
    const { imported, skipped } = importPresets(db, printerId, body.presets, req.user!);
    const result: PresetImportResult = { imported: imported.map(p => toPresetDto(db, p, req.user!)), skipped };
    return result;
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
