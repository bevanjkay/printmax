import { Buffer } from "node:buffer";

/** A one-file multipart body for `app.inject`. */
export function multipart(fields: Record<string, string>, file: { name: string; content: string | Buffer }): { headers: Record<string, string>; payload: Buffer } {
  const boundary = "----printmax";
  const head = Object.entries(fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join("");
  const fileHead = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n\r\n`;
  const payload = Buffer.concat([Buffer.from(head + fileHead), Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content), Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload };
}
