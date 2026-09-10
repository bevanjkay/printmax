import type { IppGroup, IppMessage } from "./codec.js";
import { Buffer } from "node:buffer";
import http from "node:http";
import https from "node:https";
import { attrValue, decode, encodeParts, firstGroup, GroupTag } from "./codec.js";
import { statusName } from "./constants.js";

export interface PrinterTarget {
  uri: string;
  username?: string | null;
  password?: string | null;
  timeoutMs?: number;
}

/** Network or HTTP-level failure. The request may not have reached the printer; retrying is reasonable. */
export class IppTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IppTransportError";
  }
}

/** The printer answered with an IPP error status. Retrying without changing the request is pointless. */
export class IppStatusError extends Error {
  constructor(
    public readonly status: number,
    public readonly response: IppMessage,
  ) {
    const detail = attrValue<string>(firstGroup(response, GroupTag.operation), "status-message");
    super(detail ? `${statusName(status)}: ${detail}` : statusName(status));
    this.name = "IppStatusError";
  }

  get statusName(): string {
    return statusName(this.status);
  }
}

const SCHEME_MAP: Record<string, string> = {
  "ipp:": "http:",
  "ipps:": "https:",
  "http:": "http:",
  "https:": "https:",
};

export function toHttpUrl(uri: string): URL {
  let url: URL;
  try {
    url = new URL(uri);
  }
  catch {
    throw new TypeError(`invalid printer URI: ${uri}`);
  }
  const mapped = SCHEME_MAP[url.protocol];
  if (!mapped)
    throw new TypeError(`unsupported printer URI scheme: ${url.protocol}`);
  const port = url.port || "631";
  const out = new URL(`${mapped}//${url.hostname}:${port}${url.pathname || "/"}${url.search}`);
  return out;
}

/** The URI a printer expects to see in `printer-uri`: always ipp/ipps, never http. */
export function toIppUri(uri: string): string {
  const url = new URL(uri);
  const scheme = url.protocol === "https:" || url.protocol === "ipps:" ? "ipps:" : "ipp:";
  const port = url.port ? `:${url.port}` : "";
  return `${scheme}//${url.hostname}${port}${url.pathname || "/"}`;
}

let requestCounter = Math.floor(Math.random() * 0x7FFF_FFFF);
function nextRequestId(): number {
  requestCounter = (requestCounter % 0x7FFF_FFFF) + 1;
  return requestCounter;
}

function send(url: URL, body: Buffer[], target: PrinterTarget): Promise<Buffer> {
  const isTls = url.protocol === "https:";
  const transport = isTls ? https : http;
  const headers: Record<string, string> = {
    "Content-Type": "application/ipp",
    "Content-Length": String(body.reduce((total, part) => total + part.length, 0)),
    "Accept": "application/ipp",
  };
  if (target.username)
    headers.Authorization = `Basic ${Buffer.from(`${target.username}:${target.password ?? ""}`).toString("base64")}`;

  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: "POST",
      headers,
      timeout: target.timeoutMs ?? 30_000,
      // Use Node's trust store, including NODE_EXTRA_CA_CERTS for private printer CAs.
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode === 401)
          return reject(new IppTransportError("printer requires HTTP authentication (401)"));
        if (res.statusCode !== 200)
          return reject(new IppTransportError(`printer returned HTTP ${res.statusCode}`));
        resolve(Buffer.concat(chunks));
      });
      res.on("error", err => reject(new IppTransportError(`response error: ${err.message}`, { cause: err })));
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", err => reject(new IppTransportError(`${url.host}: ${err.message}`, { cause: err })));
    for (const part of body.slice(0, -1))
      req.write(part);
    req.end(body.at(-1));
  });
}

export async function ippRequest(
  target: PrinterTarget,
  operation: number,
  groups: IppGroup[],
  data?: Buffer,
  version: [number, number] = [2, 0],
): Promise<IppMessage> {
  const url = toHttpUrl(target.uri);
  const requestId = nextRequestId();
  const body = encodeParts({ version, code: operation, requestId, groups, ...(data ? { data } : {}) });
  const raw = await send(url, body, target);
  let msg: IppMessage;
  try {
    msg = decode(raw);
  }
  catch (err) {
    throw new IppTransportError(`malformed IPP response: ${(err as Error).message}`, { cause: err });
  }
  if (msg.code === 0x0503 && version[0] === 2)
    return ippRequest(target, operation, groups, data, [1, 1]);
  if (msg.code >= 0x0400)
    throw new IppStatusError(msg.code, msg);
  return msg;
}
