import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { existsSync } from "node:fs";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { requireAdmin, requireUser, SESSION_COOKIE, sessionUser } from "./auth.js";
import { HttpError } from "./errors.js";
import { authRoutes } from "./routes/auth.js";
import { jobRoutes } from "./routes/jobs.js";
import { presetRoutes } from "./routes/presets.js";
import { adminPrinterRoutes, printerRoutes } from "./routes/printers.js";
import { userRoutes } from "./routes/users.js";

export interface AppOptions {
  db: Db;
  uploadDir: string;
  maxUploadBytes?: number;
  discoveryTimeoutMs?: number;
  staticDir?: string;
  logger?: boolean | FastifyBaseLogger;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  const { db } = opts;

  await app.register(fastifyCookie);
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

  app.addHook("onRequest", async (req) => {
    req.user = sessionUser(db, req.cookies[SESSION_COOKIE]);
  });

  app.get("/api/health", async () => ({ ok: true }));
  authRoutes(app, db);

  await app.register(async (scope) => {
    scope.addHook("onRequest", requireUser);
    printerRoutes(scope, db);
    presetRoutes(scope, db);
    jobRoutes(scope, db, opts.uploadDir);
  });

  await app.register(async (scope) => {
    scope.addHook("onRequest", requireAdmin);
    adminPrinterRoutes(scope, db, { discoveryTimeoutMs: opts.discoveryTimeoutMs ?? 3000 });
    userRoutes(scope, db);
  });

  if (opts.staticDir && existsSync(path.join(opts.staticDir, "index.html"))) {
    await app.register(fastifyStatic, { root: opts.staticDir });
    app.setNotFoundHandler((req, reply) => {
      const pathname = req.url.split("?")[0] ?? "";
      const looksLikeFile = /\.[a-z0-9]+$/i.test(pathname);
      if (req.method === "GET" && !pathname.startsWith("/api/") && !looksLikeFile)
        return reply.sendFile("index.html");
      return reply.code(404).send({ error: "not found" });
    });
  }

  return app;
}
