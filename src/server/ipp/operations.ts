import type { Buffer } from "node:buffer";
import type { PrinterTarget } from "./client.js";
import type { IppAttributes, IppGroup, IppMessage } from "./codec.js";
import { ippRequest, IppStatusError, toIppUri } from "./client.js";
import { attrValue, attrValues, firstGroup, GroupTag } from "./codec.js";
import { JOB_STATES, Operation, statusName } from "./constants.js";

function operationGroup(uri: string, extra: IppAttributes = {}): IppGroup {
  return {
    tag: GroupTag.operation,
    attributes: {
      "attributes-charset": { type: "charset", values: ["utf-8"] },
      "attributes-natural-language": { type: "naturalLanguage", values: ["en"] },
      "printer-uri": { type: "uri", values: [toIppUri(uri)] },
      ...extra,
    },
  };
}

export async function getPrinterAttributes(target: PrinterTarget, requested: string[] = ["all", "media-col-database"]): Promise<IppAttributes> {
  const msg = await ippRequest(target, Operation.GetPrinterAttributes, [
    operationGroup(target.uri, {
      "requested-attributes": { type: "keyword", values: requested },
    }),
  ]);
  return firstGroup(msg, GroupTag.printer) ?? {};
}

export interface JobStatus {
  jobId: number;
  state: string;
  stateReasons: string[];
  stateMessage?: string;
  impressionsCompleted?: number;
}

function parseJobStatus(attrs: IppAttributes | undefined, fallbackJobId = 0): JobStatus {
  const stateNum = attrValue<number>(attrs, "job-state");
  const status: JobStatus = {
    jobId: attrValue<number>(attrs, "job-id") ?? fallbackJobId,
    state: stateNum === undefined ? "unknown" : (JOB_STATES[stateNum] ?? `unknown(${stateNum})`),
    stateReasons: attrValues<string>(attrs, "job-state-reasons").filter(r => r !== "none"),
  };
  const message = attrValue<string>(attrs, "job-state-message");
  if (message)
    status.stateMessage = message;
  const impressions = attrValue<number>(attrs, "job-impressions-completed");
  if (impressions !== undefined)
    status.impressionsCompleted = impressions;
  return status;
}

export interface PrintJobInput {
  data: Buffer;
  documentFormat: string;
  jobName: string;
  requestingUserName: string;
  jobAttributes?: IppAttributes;
}

export async function printJob(target: PrinterTarget, input: PrintJobInput): Promise<JobStatus> {
  const groups: IppGroup[] = [
    operationGroup(target.uri, {
      "requesting-user-name": { type: "nameWithoutLanguage", values: [input.requestingUserName] },
      "job-name": { type: "nameWithoutLanguage", values: [input.jobName] },
      "document-format": { type: "mimeMediaType", values: [input.documentFormat] },
    }),
  ];
  if (input.jobAttributes && Object.keys(input.jobAttributes).length > 0)
    groups.push({ tag: GroupTag.job, attributes: input.jobAttributes });
  const msg = await ippRequest(target, Operation.PrintJob, groups, input.data);
  return parseJobStatus(firstGroup(msg, GroupTag.job));
}

export interface ValidateJobResult {
  accepted: boolean;
  status: string;
  message: string | null;
  /** Attributes the printer would ignore or reject, echoed back with the offending values. */
  unsupported: IppAttributes;
}

function validateResult(msg: IppMessage, ok: boolean): ValidateJobResult {
  const unsupported = firstGroup(msg, GroupTag.unsupported) ?? {};
  return {
    accepted: ok && Object.keys(unsupported).length === 0,
    status: statusName(msg.code),
    message: attrValue<string>(firstGroup(msg, GroupTag.operation), "status-message") ?? null,
    unsupported,
  };
}

/**
 * Asks the printer whether it would accept these job attributes, without printing.
 * Fidelity is requested so the printer rejects instead of silently substituting.
 */
export async function validateJob(target: PrinterTarget, input: Omit<PrintJobInput, "data">): Promise<ValidateJobResult> {
  const groups: IppGroup[] = [
    operationGroup(target.uri, {
      "requesting-user-name": { type: "nameWithoutLanguage", values: [input.requestingUserName] },
      "job-name": { type: "nameWithoutLanguage", values: [input.jobName] },
      "document-format": { type: "mimeMediaType", values: [input.documentFormat] },
      "ipp-attribute-fidelity": { type: "boolean", values: [true] },
    }),
  ];
  if (input.jobAttributes && Object.keys(input.jobAttributes).length > 0)
    groups.push({ tag: GroupTag.job, attributes: input.jobAttributes });
  try {
    return validateResult(await ippRequest(target, Operation.ValidateJob, groups), true);
  }
  catch (err) {
    if (err instanceof IppStatusError)
      return validateResult(err.response, false);
    throw err;
  }
}

const JOB_STATUS_ATTRIBUTES = ["job-id", "job-state", "job-state-reasons", "job-state-message", "job-impressions-completed"];

export async function getJobAttributes(target: PrinterTarget, jobId: number): Promise<JobStatus> {
  const msg = await ippRequest(target, Operation.GetJobAttributes, [
    operationGroup(target.uri, {
      "job-id": { type: "integer", values: [jobId] },
      "requested-attributes": { type: "keyword", values: JOB_STATUS_ATTRIBUTES },
    }),
  ]);
  return parseJobStatus(firstGroup(msg, GroupTag.job), jobId);
}

export async function cancelJob(target: PrinterTarget, jobId: number, requestingUserName: string): Promise<void> {
  await ippRequest(target, Operation.CancelJob, [
    operationGroup(target.uri, {
      "job-id": { type: "integer", values: [jobId] },
      "requesting-user-name": { type: "nameWithoutLanguage", values: [requestingUserName] },
    }),
  ]);
}
