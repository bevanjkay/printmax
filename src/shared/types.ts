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
  summary: PrinterSummary;
}

export interface JobDto {
  id: number;
  printerId: number;
  printerName: string | null;
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

export const ACTIVE_JOB_STATES = ["queued", "retrying", "pending", "pending-held", "processing", "processing-stopped"] as const;
