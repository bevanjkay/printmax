import type { FormField } from "../shared/types.js";
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

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

export function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
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

/** Maps an IPP or local job/printer state to a badge tone; the word always travels with it. */
export function stateTone(state: string): Tone {
  return STATE_TONES[state] ?? "neutral";
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
