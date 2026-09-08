import path from "node:path";
import process from "node:process";

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  uploadDir: string;
  dbPath: string;
  retentionDays: number;
  pollIntervalMs: number;
  capsRefreshHours: number;
  discoveryTimeoutMs: number;
  maxUploadBytes: number;
  staticDir: string;
  /** Required by the first-run setup page; generated and logged at startup when unset. */
  setupToken: string | null;
  /** Fastify's trustProxy: true behind a reverse proxy, false when clients reach the app directly, or a CIDR list. */
  trustProxy: boolean | string;
}

function trustProxyFrom(raw: string | undefined): boolean | string {
  if (raw === undefined || raw === "" || raw === "true")
    return true;
  if (raw === "false")
    return false;
  return raw;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "")
    return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n))
    throw new TypeError(`${name} must be a number, got "${raw}"`);
  return n;
}

export function loadConfig(env = process.env): Config {
  const dataDir = path.resolve(env.DATA_DIR ?? "data");
  return {
    port: int("PORT", 8080),
    host: env.HOST ?? "0.0.0.0",
    dataDir,
    uploadDir: path.resolve(env.UPLOAD_DIR ?? path.join(dataDir, "uploads")),
    dbPath: path.resolve(env.DB_PATH ?? path.join(dataDir, "printmax.db")),
    retentionDays: int("RETENTION_DAYS", 7),
    pollIntervalMs: int("POLL_INTERVAL_MS", 3000),
    capsRefreshHours: int("CAPS_REFRESH_HOURS", 24),
    discoveryTimeoutMs: int("DISCOVERY_TIMEOUT_MS", 3000),
    maxUploadBytes: int("MAX_UPLOAD_MB", 200) * 1024 * 1024,
    staticDir: path.resolve(env.STATIC_DIR ?? path.join(import.meta.dirname, "..", "client")),
    setupToken: env.SETUP_TOKEN || null,
    trustProxy: trustProxyFrom(env.TRUST_PROXY),
  };
}
