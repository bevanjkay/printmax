import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { addPrinter, capsFor, deletePrinter, listPrinters, refreshPrinter, requirePrinter, toDto } from "../printers.js";

interface AddPrinterBody {
  name?: string;
  uri?: string;
  username?: string | null;
  password?: string | null;
}

function idParam(params: unknown): number {
  const id = Number((params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0)
    throw new HttpError(400, "invalid id");
  return id;
}

export function printerRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/printers", async () => listPrinters(db).map(toDto));

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
    return reply.code(201).send(toDto(printer));
  });

  app.get("/api/printers/:id", async req => toDto(requirePrinter(db, idParam(req.params))));

  app.get("/api/printers/:id/caps", async req => capsFor(requirePrinter(db, idParam(req.params))));

  app.post("/api/printers/:id/refresh", async req => toDto(await refreshPrinter(db, idParam(req.params))));

  app.delete("/api/printers/:id", async (req, reply) => {
    deletePrinter(db, idParam(req.params));
    return reply.code(204).send();
  });
}
