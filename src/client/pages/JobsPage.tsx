import type { JobDto, UserDto } from "../../shared/types.js";
import { useCallback, useEffect, useState } from "react";
import { ACTIVE_JOB_STATES } from "../../shared/types.js";
import { api } from "../api.js";
import { formatDate, formatTime, useAsyncError } from "../util.js";

interface Props {
  user: UserDto;
  refreshKey: number;
}

export function JobsPage({ user, refreshKey }: Props) {
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [all, setAll] = useState(false);
  const { error, fail, clear } = useAsyncError();

  const refresh = useCallback(async () => {
    try {
      setJobs(await api.listJobs(all));
    }
    catch (err) {
      fail(err);
    }
  }, [all, fail]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh, refreshKey]);

  async function cancel(id: number) {
    clear();
    try {
      await api.cancelJob(id);
      await refresh();
    }
    catch (err) {
      fail(err);
    }
  }

  return (
    <>
      {user.role === "admin" && (
        <label className="inline">
          <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />
          Show everyone's jobs
        </label>
      )}
      {error && <p className="error">{error}</p>}
      {jobs.length === 0
        ? <p className="muted">No jobs yet.</p>
        : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>File</th>
                  {all && <th>User</th>}
                  <th>Printer</th>
                  <th>State</th>
                  <th>Details</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr key={job.id}>
                    <td>{job.id}</td>
                    <td>{job.filename}</td>
                    {all && <td>{job.userName ?? "—"}</td>}
                    <td>{job.printerName ?? job.printerId}</td>
                    <td><span className={`state state-${job.state}`}>{job.state}</span></td>
                    <td className="muted small">
                      {job.ippJobId !== null && `IPP job ${job.ippJobId}`}
                      {job.stateReasons.length > 0 && ` · ${job.stateReasons.join(", ")}`}
                      {job.stateMessage && ` · ${job.stateMessage}`}
                      {job.error && (
                        <span className="error">
                          {" · "}
                          {job.error}
                        </span>
                      )}
                      {job.state === "retrying" && job.nextAttemptAt && ` · retry ${job.attempts}/5 at ${formatTime(job.nextAttemptAt)}`}
                    </td>
                    <td className="small">{formatDate(job.createdAt)}</td>
                    <td>
                      {(ACTIVE_JOB_STATES as readonly string[]).includes(job.state) && (
                        <button className="danger small" onClick={() => cancel(job.id)}>Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
    </>
  );
}
