import type { FastifyInstance } from "fastify";
import type { ValidationResult } from "../../shared/types.js";
import type { Db } from "../db.js";
import { acknowledgeCapsChange, listCapsChanges, toCapsChangeDto } from "../capsdiff.js";
import { discoverPrinters } from "../discovery.js";
import { HttpError, notFound } from "../errors.js";
import { buildForm } from "../form.js";
import { applyResolvers } from "../ipp/constraints.js";
import { addPrinter, capsFor, deletePrinter, discoveredCaps, listPrinters, overrideCaps, refreshPrinter, requirePrinter, setDefaults, setOverrides, toDto } from "../printers.js";
import { validateJobOptions } from "../validation.js";
import { idParam } from "./params.js";

interface AddPrinterBody {
  name?: string;
  uri?: string;
  username?: string | null;
  password?: string | null;
}

/** Routes any signed-in user may call. */
export function printerRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/printers", async () => listPrinters(db).map(p => toDto(db, p)));

  app.get("/api/printers/:id", async req => toDto(db, requirePrinter(db, idParam(req.params))));

  app.get("/api/printers/:id/caps", async (req) => {
    const printer = requirePrinter(db, idParam(req.params));
    const layer = (req.query as { layer?: string }).layer ?? "merged";
    if (layer === "discovered")
      return discoveredCaps(printer);
    if (layer === "overrides")
      return overrideCaps(printer);
    return capsFor(printer);
  });

  /** The generated option editor: fields, choices and defaults from the printer's own attributes. */
  app.get("/api/printers/:id/form", async req => buildForm(capsFor(requirePrinter(db, idParam(req.params)))));

  app.post("/api/printers/:id/validate", async (req): Promise<ValidationResult> => {
    const printer = requirePrinter(db, idParam(req.params));
    const body = (req.body ?? {}) as { options?: unknown };
    if (typeof body.options !== "object" || body.options === null || Array.isArray(body.options))
      throw new HttpError(400, "options must be an object");
    const options = body.options as Record<string, unknown>;
    const caps = capsFor(printer);
    const errors = validateJobOptions(options, caps);
    let resolved = options;
    if (errors.length > 0) {
      try {
        resolved = applyResolvers(options, caps);
      }
      catch {
        resolved = options;
      }
    }
    return { errors, resolved };
  });
}

/** Routes restricted to admins. */
export function adminPrinterRoutes(app: FastifyInstance, db: Db, opts: { discoveryTimeoutMs: number }): void {
  app.post("/api/printers", async (req, reply) => {
    const body = (req.body ?? {}) as AddPrinterBody;
    if (typeof body.uri !== "string" || body.uri.trim() === "")
      throw new HttpError(400, "uri is required");
    const printer = await addPrinter(db, {
      uri: body.uri,
      ...(body.name ? { name: body.name } : {}),
      username: body.username || null,
      password: body.password || null,
    });
    return reply.code(201).send(toDto(db, printer));
  });

  app.post("/api/printers/:id/refresh", async req => toDto(db, await refreshPrinter(db, idParam(req.params))));

  /** Per-printer defaults for the print form, stored as `<attribute>-default` overrides. */
  app.put("/api/printers/:id/defaults", async (req) => {
    const body = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body))
      throw new HttpError(400, "defaults must be an object of attribute names to values");
    return toDto(db, setDefaults(db, idParam(req.params), body as Record<string, unknown>));
  });

  app.put("/api/printers/:id/overrides", async (req) => {
    const printer = setOverrides(db, idParam(req.params), req.body);
    return toDto(db, printer);
  });

  app.get("/api/printers/:id/changes", async (req) => {
    const id = idParam(req.params);
    requirePrinter(db, id);
    const all = (req.query as { all?: string }).all === "true";
    return listCapsChanges(db, id, all).map(toCapsChangeDto);
  });

  app.post("/api/printers/:id/changes/:changeId/ack", async (req, reply) => {
    const id = idParam(req.params);
    requirePrinter(db, id);
    if (!acknowledgeCapsChange(db, id, idParam(req.params, "changeId")))
      throw notFound("change");
    return reply.code(204).send();
  });

  app.delete("/api/printers/:id", async (req, reply) => {
    deletePrinter(db, idParam(req.params));
    return reply.code(204).send();
  });

  app.get("/api/discover", async () => discoverPrinters(opts.discoveryTimeoutMs));
}
