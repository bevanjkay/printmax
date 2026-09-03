/**
 * DNS-SD browse for IPP printers on the local network. Convenience only: mDNS does not
 * cross the Docker bridge or VLANs, so manual URI entry is the reliable path.
 */
import type { DiscoveredPrinter } from "../shared/types.js";
import { Bonjour } from "bonjour-service";

interface FoundService {
  name: string;
  host: string;
  port: number;
  addresses?: string[];
  txt?: Record<string, unknown>;
  type: string;
}

function txtValue(txt: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!txt)
    return undefined;
  const wanted = key.toLowerCase();
  for (const [k, v] of Object.entries(txt)) {
    if (k.toLowerCase() === wanted && v !== undefined && v !== null && v !== "")
      return typeof v === "string" ? v : String(v);
  }
  return undefined;
}

function isIpv4(address: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address);
}

export async function discoverPrinters(timeoutMs = 3000): Promise<DiscoveredPrinter[]> {
  const bonjour = new Bonjour();
  const found = new Map<string, DiscoveredPrinter>();

  const onService = (service: FoundService): void => {
    const host = service.addresses?.find(isIpv4) ?? service.addresses?.[0] ?? service.host;
    if (!host)
      return;
    const rp = txtValue(service.txt, "rp") ?? "ipp/print";
    const scheme = service.type === "ipps" ? "ipps" : "ipp";
    const uri = `${scheme}://${host}:${service.port}/${rp.replace(/^\//, "")}`;
    const key = txtValue(service.txt, "UUID") ?? `${service.name}@${host}`;
    const existing = found.get(key);
    const entry: DiscoveredPrinter = existing ?? {
      name: service.name,
      host,
      makeModel: txtValue(service.txt, "ty") ?? null,
      location: txtValue(service.txt, "note") ?? null,
      uuid: txtValue(service.txt, "UUID") ?? null,
      formats: (txtValue(service.txt, "pdl") ?? "").split(",").map(s => s.trim()).filter(Boolean),
      color: txtValue(service.txt, "Color") === "T",
      duplex: txtValue(service.txt, "Duplex") === "T",
      uri: null,
      secureUri: null,
    };
    if (scheme === "ipps")
      entry.secureUri = uri;
    else
      entry.uri = uri;
    found.set(key, entry);
  };

  const browsers = ["ipp", "ipps"].map(type => bonjour.find({ type }, s => onService(s as unknown as FoundService)));
  await new Promise(resolve => setTimeout(resolve, timeoutMs));
  for (const b of browsers)
    b.stop();
  await new Promise<void>(resolve => bonjour.destroy(() => resolve()));
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
