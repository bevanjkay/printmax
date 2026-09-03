import type { Widget } from "./attributes.js";

export interface UserDto {
  id: number;
  email: string;
  name: string;
  role: "admin" | "user";
  createdAt: string;
}

export interface AuthState {
  user: UserDto | null;
  needsSetup: boolean;
}

export interface PrinterSummary {
  state: string;
  stateReasons: string[];
  documentFormats: string[];
  sides: string[];
  colorModes: string[];
  media: string[];
  mediaSources: string[];
  finishings: string[];
  outputBins: string[];
  printQuality: string[];
  copiesMax: number;
  jobCreationAttributes: string[];
  jobAccountIdSupported: boolean;
  hasConstraints: boolean;
  defaults: Record<string, string | number>;
}

export interface PrinterDto {
  id: number;
  name: string;
  uri: string;
  hasCredentials: boolean;
  uuid: string | null;
  makeModel: string | null;
  location: string | null;
  capsFetchedAt: string | null;
  createdAt: string;
  overrideCount: number;
  pendingChanges: number;
  summary: PrinterSummary;
}

export interface FormChoice {
  value: string | number;
  label: string;
}

export interface FormField {
  name: string;
  label: string;
  widget: Widget;
  help?: string;
  choices?: FormChoice[];
  default?: string | number | Array<string | number>;
  min?: number;
  max?: number;
}

export interface ValidationResult {
  errors: string[];
  /** Options after applying the printer's own resolvers; equals the input when nothing conflicted. */
  resolved: Record<string, unknown>;
}

export interface PresetDto {
  id: number;
  printerId: number;
  name: string;
  description: string | null;
  scope: "global" | "user";
  ownerId: number | null;
  options: Record<string, unknown>;
  /** Validation problems against the printer's current capabilities; non-empty means the preset needs attention. */
  problems: string[];
  editable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobDto {
  id: number;
  userId: number | null;
  userName: string | null;
  printerId: number;
  printerName: string | null;
  presetId: number | null;
  filename: string;
  byteSize: number;
  documentFormat: string;
  options: Record<string, unknown>;
  ippJobId: number | null;
  state: string;
  stateReasons: string[];
  stateMessage: string | null;
  error: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  fileRetained: boolean;
}

export interface CapsChangeDto {
  id: number;
  printerId: number;
  fetchedAt: string;
  added: string[];
  removed: string[];
  changed: string[];
  acknowledgedAt: string | null;
}

export interface DiscoveredPrinter {
  name: string;
  host: string;
  makeModel: string | null;
  location: string | null;
  uuid: string | null;
  formats: string[];
  color: boolean;
  duplex: boolean;
  uri: string | null;
  secureUri: string | null;
}

export const ACTIVE_JOB_STATES = ["queued", "retrying", "pending", "pending-held", "processing", "processing-stopped"] as const;
