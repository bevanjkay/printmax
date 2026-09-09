import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { getPrinterAttributes } from "../src/server/ipp/operations.js";

const run = promisify(execFile);

it("rejects an untrusted printer before sending credentials and accepts an explicitly trusted certificate", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "printmax-tls-"));
  let server: https.Server | undefined;
  const credentials: Array<string | undefined> = [];
  try {
    const cert = path.join(dir, "cert.pem");
    const key = path.join(dir, "key.pem");
    await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1", "-days", "1"], { timeout: 5000 });
    server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
      credentials.push(req.headers.authorization);
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/ipp" });
        res.end(Buffer.from([2, 0, 0, 0, 0, 0, 0, 1, 3]));
      });
    });
    const srv = server;
    await new Promise<void>((resolve, reject) => {
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as { port: number }).port;
    const target = { uri: `ipps://127.0.0.1:${port}/ipp/print`, username: "dummy-user", password: "dummy-password" };
    await expect(getPrinterAttributes(target)).rejects.toThrow(/self.signed certificate/i);
    expect(credentials).toEqual([]);
    // Node reads extra CAs at startup, so verify the deployment configuration in a fresh process.
    const module = new URL("../src/server/ipp/operations.ts", import.meta.url).href;
    await run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import { getPrinterAttributes } from ${JSON.stringify(module)}; await getPrinterAttributes(${JSON.stringify(target)});`], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: cert },
      timeout: 5000,
    });
    expect(credentials).toEqual([`Basic ${Buffer.from("dummy-user:dummy-password").toString("base64")}`]);
  }
  finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server!.close(() => resolve()));
    }
    await rm(dir, { recursive: true, force: true });
  }
});
