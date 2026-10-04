import type { JobDto, PrinterDto } from "../shared/types.js";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { remember, remembered, useAsyncError } from "./util.js";

/** Polls the job list every few seconds; `refreshKey` forces an immediate reload. */
export function useJobs(opts: { all: boolean; limit?: number; refreshKey?: number }) {
  const [jobs, setJobs] = useState<JobDto[] | null>(null);
  const { error, fail, clear } = useAsyncError();
  const refresh = useCallback(async () => {
    try {
      const list = await api.listJobs(opts.all);
      setJobs(opts.limit ? list.slice(0, opts.limit) : list);
      clear();
    }
    catch (err) {
      fail(err);
    }
  }, [opts.all, opts.limit, fail, clear]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh, opts.refreshKey]);

  return { jobs, error, refresh };
}

const PRINTER_KEY = "printmax:printer";

/** The printer last chosen on any page, so Print, Presets and Library open on the same one. */
export function useChosenPrinter(printers: PrinterDto[]): [PrinterDto | undefined, (id: number) => void] {
  const [id, setId] = useState(() => Number(remembered(PRINTER_KEY)) || null);
  const choose = useCallback((next: number) => {
    setId(next);
    remember(PRINTER_KEY, String(next));
  }, []);
  return [printers.find(p => p.id === id) ?? printers[0], choose];
}
