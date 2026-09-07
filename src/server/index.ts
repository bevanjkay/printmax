import { accessSync, constants, mkdirSync } from "node:fs";
import process from "node:process";
import { buildApp } from "./app.js";
import { purgeExpiredSessions } from "./auth.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { startJobWorker, sweepExpiredFiles } from "./jobs.js";

async function main(): Promise<void> {
  const config = loadConfig();
  try {
    mkdirSync(config.uploadDir, { recursive: true });
    accessSync(config.dataDir, constants.W_OK);
    accessSync(config.uploadDir, constants.W_OK);
  }
  catch (err) {
    const uid = process.getuid?.() ?? "?";
    console.error(`printmax cannot write to ${config.dataDir} (${(err as NodeJS.ErrnoException).code ?? err}). The server runs as uid ${uid}; make the directory writable by it, e.g. chown 1000:1000 the host path mounted at /data.`);
    process.exit(1);
  }
  const db = openDb(config.dbPath);

  const app = await buildApp({
    db,
    uploadDir: config.uploadDir,
    maxUploadBytes: config.maxUploadBytes,
    discoveryTimeoutMs: config.discoveryTimeoutMs,
    staticDir: config.staticDir,
    logger: true,
  });

  const worker = startJobWorker(db, {
    intervalMs: config.pollIntervalMs,
    capsRefreshHours: config.capsRefreshHours,
    onError: err => app.log.error(err, "job worker error"),
    onInfo: (message, data) => app.log.warn(data ?? {}, message),
  });

  async function sweep(): Promise<void> {
    try {
      purgeExpiredSessions(db);
      const removed = await sweepExpiredFiles(db, config.retentionDays);
      if (removed > 0)
        app.log.info({ removed }, "removed expired uploads");
    }
    catch (err) {
      app.log.error(err, "retention sweep failed");
    }
  }
  const sweeper = setInterval(() => void sweep(), 60 * 60 * 1000);
  void sweep();

  async function shutdown(signal: string): Promise<void> {
    app.log.info({ signal }, "shutting down");
    worker.stop();
    clearInterval(sweeper);
    await app.close();
    db.close();
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
