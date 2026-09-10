import type { AuthState, CapsChangeDto, DiscoveredPrinter, FormField, JobDto, PresetDto, PresetExport, PresetExportItem, PresetImportResult, PrinterDto, PrintMode, ProbeResult, StoredJobDto, UserDto, ValidationResult } from "../shared/types.js";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...init });
  if (res.status === 204)
    return undefined as T;
  const body = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok)
    throw new ApiError(res.status, body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  };
}

export type Options = Record<string, unknown>;

export const api = {
  me: () => request<AuthState>("/api/auth/me"),
  setup: (input: { name: string; email: string; password: string; setupToken?: string }) => request<UserDto>("/api/auth/setup", json("POST", input)),
  login: (input: { email: string; password: string }) => request<UserDto>("/api/auth/login", json("POST", input)),
  logout: () => request<void>("/api/auth/logout", json("POST")),
  changePassword: (input: { currentPassword: string; newPassword: string }) => request<void>("/api/auth/password", json("POST", input)),

  listPrinters: () => request<PrinterDto[]>("/api/printers"),
  getForm: (printerId: number) => request<FormField[]>(`/api/printers/${printerId}/form`),
  getCaps: (printerId: number, layer: "merged" | "discovered" | "overrides" = "merged") => request<Record<string, { type: string; values: unknown[] }>>(`/api/printers/${printerId}/caps?layer=${layer}`),
  validate: (printerId: number, options: Options) => request<ValidationResult>(`/api/printers/${printerId}/validate`, json("POST", { options })),
  probe: (printerId: number, options: Options) => request<ProbeResult>(`/api/printers/${printerId}/probe`, json("POST", { options })),
  addPrinter: (input: { name?: string; uri: string; username?: string; password?: string }) => request<PrinterDto>("/api/printers", json("POST", input)),
  refreshPrinter: (id: number) => request<PrinterDto>(`/api/printers/${id}/refresh`, json("POST")),
  deletePrinter: (id: number) => request<void>(`/api/printers/${id}`, json("DELETE")),
  setDefaults: (id: number, defaults: Record<string, unknown>) => request<PrinterDto>(`/api/printers/${id}/defaults`, json("PUT", defaults)),
  setPpd: (id: number, ppd: string) => request<PrinterDto>(`/api/printers/${id}/ppd`, json("PUT", { ppd })),
  clearPpd: (id: number) => request<PrinterDto>(`/api/printers/${id}/ppd`, json("DELETE")),
  setPrintMode: (id: number, mode: PrintMode) => request<PrinterDto>(`/api/printers/${id}/mode`, json("PUT", { mode })),
  setOverrides: (id: number, overrides: Record<string, { type: string; values: unknown[] }>) => request<PrinterDto>(`/api/printers/${id}/overrides`, json("PUT", overrides)),
  listChanges: (id: number) => request<CapsChangeDto[]>(`/api/printers/${id}/changes`),
  ackChange: (id: number, changeId: number) => request<void>(`/api/printers/${id}/changes/${changeId}/ack`, json("POST")),
  discover: () => request<DiscoveredPrinter[]>("/api/discover"),

  listPresets: (printerId?: number) => request<PresetDto[]>(`/api/presets${printerId ? `?printerId=${printerId}` : ""}`),
  createPreset: (input: { printerId: number; name: string; description?: string; scope: "global" | "user"; options: Options }) => request<PresetDto>("/api/presets", json("POST", input)),
  updatePreset: (id: number, input: { printerId: number; name: string; description?: string; scope: "global" | "user"; options: Options }) => request<PresetDto>(`/api/presets/${id}`, json("PUT", input)),
  deletePreset: (id: number) => request<void>(`/api/presets/${id}`, json("DELETE")),
  exportPresets: (printerId: number) => request<PresetExport>(`/api/presets/export?printerId=${printerId}`),
  importPresets: (printerId: number, presets: PresetExportItem[]) => request<PresetImportResult>("/api/presets/import", json("POST", { printerId, presets })),

  listJobs: (all = false) => request<JobDto[]>(`/api/jobs${all ? "?all=true" : ""}`),
  cancelJob: (id: number) => request<JobDto>(`/api/jobs/${id}/cancel`, json("POST")),
  reprintJob: (id: number, copies?: number) => request<JobDto>(`/api/jobs/${id}/reprint`, json("POST", copies === undefined ? {} : { copies })),
  submitJob: (printerId: number, presetId: number | null, file: File, options: Options) => {
    const form = new FormData();
    form.append("printerId", String(printerId));
    if (presetId)
      form.append("presetId", String(presetId));
    form.append("options", JSON.stringify(options));
    form.append("file", file);
    return request<JobDto>("/api/jobs", { method: "POST", body: form });
  },

  listLibrary: (printerId?: number) => request<StoredJobDto[]>(`/api/library${printerId ? `?printerId=${printerId}` : ""}`),
  addToLibrary: (input: { printerId: number; presetId: number | null; name: string; group: string; scope: "global" | "user"; file: File }) => {
    const form = new FormData();
    form.append("printerId", String(input.printerId));
    if (input.presetId)
      form.append("presetId", String(input.presetId));
    form.append("name", input.name);
    form.append("group", input.group);
    form.append("scope", input.scope);
    form.append("file", input.file);
    return request<StoredJobDto>("/api/library", { method: "POST", body: form });
  },
  keepJob: (jobId: number, input: { name: string; scope: "global" | "user" }) => request<StoredJobDto>(`/api/library/from-job/${jobId}`, json("POST", input)),
  updateStoredJob: (id: number, input: { name: string; presetId: number | null; group: string; scope: "global" | "user"; options: Options }) => request<StoredJobDto>(`/api/library/${id}`, json("PUT", input)),
  replaceStoredFile: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<StoredJobDto>(`/api/library/${id}/file`, { method: "PUT", body: form });
  },
  printStoredJob: (id: number, copies?: number) => request<JobDto>(`/api/library/${id}/print`, json("POST", copies === undefined ? {} : { copies })),
  deleteStoredJob: (id: number) => request<void>(`/api/library/${id}`, json("DELETE")),

  listUsers: () => request<UserDto[]>("/api/users"),
  setUserRole: (id: number, role: "admin" | "user") => request<UserDto>(`/api/users/${id}/role`, json("PUT", { role })),
  createUser: (input: { name: string; email: string; password: string; role: "admin" | "user" }) => request<UserDto>("/api/users", json("POST", input)),
  deleteUser: (id: number) => request<void>(`/api/users/${id}`, json("DELETE")),
  setUserPassword: (id: number, password: string) => request<void>(`/api/users/${id}/password`, json("POST", { password })),
};
