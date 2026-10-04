import type { DocumentSize, FormField } from "../shared/types.js";
import { useCallback, useEffect, useRef, useState } from "react";

export type OptionValues = Record<string, unknown>;

/** Builds the initial option map from a printer's generated form. */
export function defaultsFrom(fields: FormField[]): OptionValues {
  const out: OptionValues = {};
  for (const f of fields) {
    if (f.default !== undefined)
      out[f.name] = f.default;
  }
  return out;
}

const MEDIA_BOX = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g;

/**
 * The largest page box a PDF states in the clear, to measure against the paper before printing.
 * Pages held in compressed object streams are invisible here, and simply go unmeasured.
 */
export function pdfPageSize(bytes: Uint8Array): DocumentSize | null {
  const text = new TextDecoder("latin1").decode(bytes);
  let largest: DocumentSize | null = null;
  for (const box of text.matchAll(MEDIA_BOX)) {
    const width = Math.abs(Number(box[3]) - Number(box[1]));
    const height = Math.abs(Number(box[4]) - Number(box[2]));
    if (width > 0 && height > 0 && (!largest || width * height > largest.width * largest.height))
      largest = { width, height };
  }
  return largest;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

export function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

/** Browser storage for small conveniences; a private window that refuses it just forgets. */
export function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  }
  catch {
    return null;
  }
}

export function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  }
  catch {
    // not kept
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useAsyncError(): { error: string | null; fail: (e: unknown) => void; clear: () => void } {
  const [error, setError] = useState<string | null>(null);
  const fail = useCallback((e: unknown) => setError(errorMessage(e)), []);
  const clear = useCallback(() => setError(null), []);
  return { error, fail, clear };
}

/** Runs the latest `fn` after `delayMs` of no changes to `value`. */
export function useDebounced(fn: (value: OptionValues) => void, value: OptionValues, delayMs: number): void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const serialised = JSON.stringify(value);
  useEffect(() => {
    const timer = setTimeout(() => fnRef.current(JSON.parse(serialised) as OptionValues), delayMs);
    return () => clearTimeout(timer);
  }, [serialised, delayMs]);
}

/**
 * Asks the browser to confirm before the tab is closed or navigated away from, for as long as
 * something must not be interrupted. The wording is the browser's own; a page can only ask.
 */
export function useWarnBeforeLeaving(active: boolean): void {
  useEffect(() => {
    if (!active)
      return;
    const confirmLeaving = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Still required by browsers that predate preventDefault being enough on its own.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", confirmLeaving);
    return () => window.removeEventListener("beforeunload", confirmLeaving);
  }, [active]);
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "progress";

const STATE_TONES: Record<string, Tone> = {
  "queued": "neutral",
  "retrying": "warning",
  "pending": "info",
  "pending-held": "warning",
  "processing": "progress",
  "processing-stopped": "warning",
  "completed": "success",
  "canceled": "neutral",
  "aborted": "danger",
  "failed": "danger",
  "unknown": "neutral",
  "idle": "success",
  "stopped": "danger",
};

/** Reasons a job carries while things are normal; anything else on a stopped job is the printer's problem. */
const BENIGN_REASONS = new Set(["none", "job-incoming", "job-queued", "job-queued-for-marker", "job-printing", "job-data-insufficient", "job-transforming"]);

/**
 * Maps an IPP or local job/printer state to a badge tone; the word always travels with it.
 * Some printers pass every job through processing-stopped while taking it in, so that state
 * is only amber when the printer gives a reason for the stop.
 */
export function stateTone(state: string, reasons: string[] = []): Tone {
  if (state === "processing-stopped")
    return reasons.some(r => !BENIGN_REASONS.has(r)) ? "warning" : "progress";
  return STATE_TONES[state] ?? "neutral";
}

const STATE_LABELS: Record<string, string> = {
  "queued": "Waiting to send",
  "retrying": "Retrying",
  "pending": "Queued",
  "pending-held": "On hold",
  "processing": "Printing",
  "processing-stopped": "Paused",
  "completed": "Printed",
  "canceled": "Cancelled",
  "aborted": "Failed",
  "failed": "Failed",
  "unknown": "Unknown",
  "idle": "Ready",
  "stopped": "Stopped",
};

/** The badge word for a job or printer state; the IPP keyword stays available as a tooltip. */
export function stateLabel(state: string, reasons: string[] = []): string {
  if (state === "processing-stopped" && stateTone(state, reasons) === "progress")
    return "Printing";
  return STATE_LABELS[state] ?? sentence(state);
}

/** The job-state-reasons people meet, in their words; the rest are spelled out from the keyword. */
const JOB_REASON_TEXT: Record<string, string> = {
  "document-format-error": "The printer can't read this kind of file",
  "unsupported-document-format": "The printer can't read this kind of file",
  "document-unprintable-error": "The printer couldn't draw part of the document",
  "document-access-error": "The printer couldn't fetch the document",
  "compression-error": "The document arrived damaged",
  "job-canceled-by-user": "Cancelled from printmax",
  "job-canceled-by-operator": "Cancelled by an operator",
  "job-canceled-at-device": "Cancelled at the printer",
  "aborted-by-system": "The printer gave up on it",
  "job-completed-with-errors": "Finished, but the printer reported errors",
  "job-completed-with-warnings": "Finished, with warnings from the printer",
  "job-hold-until-specified": "Held until someone releases it at the printer",
  "printer-stopped": "The printer is stopped",
  "printer-stopped-partly": "Part of the printer is stopped",
};

/** Job reasons worth showing: the ones that explain a stop, a failure or a hold, in plain words. */
export function jobReasons(reasons: string[]): string[] {
  return reasons.filter(r => !BENIGN_REASONS.has(r)).map(r => JOB_REASON_TEXT[r] ?? sentence(r));
}

function sentence(keyword: string): string {
  return keyword.replace(/-/g, " ").replace(/^\w/, c => c.toUpperCase());
}

/** "3 presets, 1 library document and 212 jobs" from the counts that aren't zero. */
export function countList(parts: Array<[number, string]>): string {
  const words = parts.filter(([n]) => n > 0).map(([n, noun]) => `${n} ${n === 1 ? noun : `${noun}s`}`);
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0] ?? "";
}

/** Choice labels that say "nothing special" and add nothing to a summary. */
const SILENT_LABELS = new Set(["none", "off", "false", "no", "auto", "automatic", "auto (default)", "printer's default", "printer default", "normal"]);
const ON_LABELS = new Set(["on", "true", "yes"]);

/**
 * Plain-English summary of the options that matter, e.g. "2 copies · Double-sided · A4 · Saddle Stitch".
 * Values that mean "off" or "default" are left out, and a switched-on boolean reads as its option's
 * name ("Folding") rather than "On". With `changesOnly`, values equal to the printer's default are
 * also left out, which is what a preset card should show.
 */
export function summariseOptions(fields: FormField[], value: OptionValues, names: string[], opts: { changesOnly?: boolean } = {}): string {
  const parts: string[] = [];
  for (const name of names) {
    const field = fields.find(f => f.name === name);
    const v = opts.changesOnly ? value[name] : value[name] ?? field?.default;
    if (!field || v === undefined || v === "")
      continue;
    if (opts.changesOnly && field.default !== undefined && String(v) === String(field.default))
      continue;
    if (name === "copies") {
      const n = Number(v);
      if (!opts.changesOnly || n > 1)
        parts.push(`${n} ${n === 1 ? "copy" : "copies"}`);
      continue;
    }
    const values = Array.isArray(v) ? v : [v];
    for (const x of values) {
      const label = field.choices?.find(c => String(c.value) === String(x))?.label ?? String(x);
      const key = label.trim().toLowerCase();
      if (SILENT_LABELS.has(key))
        continue;
      parts.push(ON_LABELS.has(key) ? field.label : contextualise(name, label));
    }
  }
  return parts.join(" · ");
}

/** A bare "A3" or "Lower Left" needs its option to make sense in a one-line summary. */
function contextualise(name: string, label: string): string {
  if (name.endsWith("BookletPaperSize"))
    return `Booklet on ${label}`;
  if (name.endsWith("Stapling") && !/stitch|staple/i.test(label))
    return `${label} staple`;
  return label;
}

/**
 * IPP printer-state-reasons as a person would say them: "marker-waste-almost-full-warning" becomes
 * "Marker waste almost full", with its severity kept separately for colouring.
 */
export function describeReason(reason: string): { text: string; severity: "error" | "warning" | "report" } {
  const m = /^(.*?)(?:-(error|warning|report))?$/.exec(reason);
  const text = (m?.[1] ?? reason).replace(/-/g, " ").replace(/^\w/, c => c.toUpperCase());
  return { text, severity: (m?.[2] as "error" | "warning" | "report" | undefined) ?? "error" };
}
