/**
 * Fetches Get-Printer-Attributes from a printer and prints it as JSON.
 * Usage: pnpm dump-caps ipp://host/ipp/print [username password] > fixtures/name.json
 */
import process from "node:process";
import { getPrinterAttributes } from "../src/server/ipp/operations.js";

const [uri, username, password] = process.argv.slice(2);
if (!uri) {
  console.error("usage: pnpm dump-caps <ipp-uri> [username password]");
  process.exit(2);
}
const caps = await getPrinterAttributes({ uri, username, password });
console.log(JSON.stringify(caps, null, 2));
