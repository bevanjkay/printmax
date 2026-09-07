import type { Buffer } from "node:buffer";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { getPrinterAttributes } from "../../src/server/ipp/operations.js";

export interface VirtualPrinter {
  uri: string;
  stop: () => Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export async function ippeveprinterAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("ippeveprinter", ["--help"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", () => resolve(true));
  });
}

/** Starts CUPS' `ippeveprinter` sample IPP Everywhere printer on a free port, without DNS-SD. */
export async function startVirtualPrinter(name = "printmax test"): Promise<VirtualPrinter> {
  const port = await freePort();
  const spool = await mkdtemp(path.join(tmpdir(), "printmax-spool-"));
  const child: ChildProcess = spawn("ippeveprinter", [
    "-r",
    "off",
    "-n",
    "localhost",
    "-p",
    String(port),
    "-d",
    spool,
    "-f",
    "application/pdf,image/jpeg,image/png,application/postscript,application/octet-stream",
    "-2",
    name,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const stderr: string[] = [];
  child.stderr?.on("data", (c: Buffer) => stderr.push(c.toString()));

  const uri = `ipp://localhost:${port}/ipp/print`;
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`ippeveprinter exited early: ${stderr.join("")}`);
    try {
      await getPrinterAttributes({ uri, timeoutMs: 2000 }, ["printer-name"]);
      lastError = undefined;
      break;
    }
    catch (err) {
      lastError = err;
      await new Promise(r => setTimeout(r, 200));
    }
  }
  if (lastError)
    throw new Error(`ippeveprinter did not become ready: ${(lastError as Error).message}`);

  return {
    uri,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise<void>(resolve => child.on("exit", () => resolve()));
      await rm(spool, { recursive: true, force: true });
    },
  };
}
