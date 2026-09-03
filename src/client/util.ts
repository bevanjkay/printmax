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

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
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
