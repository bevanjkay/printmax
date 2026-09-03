import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { existsSync } from "node:fs";
import path from "node:path";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { HttpError } from "./errors.js";
import { jobRoutes } from "./routes/jobs.js";
import { printerRoutes } from "./routes/printers.js";

export interface AppOptions {
  db: Db;
  uploadDir: string;
  maxUploadBytes?: number;
  staticDir?: string;
  logger?: boolean | FastifyBaseLogger;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(fastifyMultipart, {
    limits: { fileSize: opts.maxUploadBytes ?? 200 * 1024 * 1024, files: 1 },
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError)
      return reply.code(err.statusCode).send({ error: err.message });
    const status = err.statusCode;
    if (status && status >= 400 && status < 500)
      return reply.code(status).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: "internal error" });
  });

  app.get("/api/health", async () => ({ ok: true }));
  printerRoutes(app, opts.db);
  jobRoutes(app, opts.db, opts.uploadDir);

  if (opts.staticDir && existsSync(path.join(opts.staticDir, "index.html"))) {
    await app.register(fastifyStatic, { root: opts.staticDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/"))
        return reply.sendFile("index.html");
      return reply.code(404).send({ error: "not found" });
    });
  }

  return app;
}
