import type { JobDto, PrinterDto } from "../shared/types.js";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 204)
    return undefined as T;
  const body = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok)
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export const api = {
  listPrinters: () => request<PrinterDto[]>("/api/printers"),
  addPrinter: (input: { name?: string; uri: string; username?: string; password?: string }) =>
    request<PrinterDto>("/api/printers", json("POST", input)),
  refreshPrinter: (id: number) => request<PrinterDto>(`/api/printers/${id}/refresh`, json("POST")),
  deletePrinter: (id: number) => request<void>(`/api/printers/${id}`, json("DELETE")),
  listJobs: () => request<JobDto[]>("/api/jobs"),
  cancelJob: (id: number) => request<JobDto>(`/api/jobs/${id}/cancel`, json("POST")),
  submitJob: (printerId: number, file: File, options: Record<string, unknown>) => {
    const form = new FormData();
    form.append("printerId", String(printerId));
    form.append("options", JSON.stringify(options));
    form.append("file", file);
    return request<JobDto>("/api/jobs", { method: "POST", body: form });
  },
};
