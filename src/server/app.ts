import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { existsSync } from "node:fs";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
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
  /** When set, the first-run setup page must present this token. */
  setupToken?: string | null;
  /** Default true: the usual deployment sits behind a reverse proxy that sets X-Forwarded-*. */
  trustProxy?: boolean | string;
  /** Attempts allowed per client IP per minute on sign-in and setup. */
  loginAttemptsPerMinute?: number;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.trustProxy ?? true });
  const { db } = opts;

  // The app loads nothing from outside itself, so the policy can be strict. Inline styles are
  // React's style props; data: images are the CSS select chevron. No upgrade-insecure-requests,
  // because a LAN install may legitimately run on plain HTTP.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "font-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": null,
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: "deny" },
  });
  await app.register(fastifyRateLimit, {
    global: false,
    max: opts.loginAttemptsPerMinute ?? 10,
    timeWindow: "1 minute",
    errorResponseBuilder: (_req, context) => new HttpError(429, `too many attempts; try again in ${Math.ceil(context.ttl / 1000)} seconds`),
  });
  await app.register(fastifyCookie);
  // Browsers send "Content-Type: application/json" on body-less POSTs; Fastify rejects those by default.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "")
      return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    }
    catch (err) {
      done(Object.assign(err as Error, { statusCode: 400 }), undefined);
    }
  });
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
  authRoutes(app, db, { setupToken: opts.setupToken ?? null });

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
