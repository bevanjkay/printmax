import type { JobDto } from "../shared/types.js";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { useAsyncError } from "./util.js";

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
