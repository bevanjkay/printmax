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

/** Plain-English summary of the options that matter, e.g. "2 copies · Double-sided · Black and white · A4". */
export function summariseOptions(fields: FormField[], value: OptionValues, names: string[]): string {
  const parts: string[] = [];
  for (const name of names) {
    const field = fields.find(f => f.name === name);
    const v = value[name] ?? field?.default;
    if (!field || v === undefined || v === "")
      continue;
    if (name === "copies") {
      const n = Number(v);
      parts.push(`${n} ${n === 1 ? "copy" : "copies"}`);
      continue;
    }
    const values = Array.isArray(v) ? v : [v];
    const labels = values.map(x => field.choices?.find(c => String(c.value) === String(x))?.label ?? String(x)).filter(l => l !== "None");
    if (labels.length > 0)
      parts.push(labels.join(", "));
  }
  return parts.join(" · ");
}
