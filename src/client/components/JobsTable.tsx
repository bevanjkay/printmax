import type { JobDto } from "../../shared/types.js";
import { useEffect, useRef } from "react";
import { ACTIVE_JOB_STATES } from "../../shared/types.js";
import { api } from "../api.js";
import { formatDate, formatTime, useAsyncError } from "../util.js";
import { IconInbox } from "./Icons.js";
import { EmptyState, Notice, SkeletonRows, StateBadge } from "./ui.js";

interface Props {
  jobs: JobDto[] | null;
  error: string | null;
  showUser?: boolean;
  onChanged: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function JobsTable({ jobs, error, showUser, onChanged, emptyTitle = "No jobs yet", emptyDescription = "Jobs you print will show up here with what the printer said about them." }: Props) {
  const { error: actionError, fail, clear } = useAsyncError();
  const seenRef = useRef<Set<number>>(new Set());
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (jobs && firstRenderRef.current) {
      firstRenderRef.current = false;
      for (const j of jobs)
        seenRef.current.add(j.id);
    }
  }, [jobs]);

  async function cancel(id: number) {
    clear();
    try {
      await api.cancelJob(id);
      onChanged();
    }
    catch (err) {
      fail(err);
    }
  }

  if (!jobs)
    return <div className="table-wrap"><SkeletonRows /></div>;

  return (
    <div className="stack">
      {(error || actionError) && <Notice tone="error">{error ?? actionError}</Notice>}
      <div className="table-wrap">
        {jobs.length === 0
          ? <EmptyState icon={<IconInbox />} title={emptyTitle} description={emptyDescription} />
          : (
              <table className="table jobs">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Document</th>
                    {showUser && <th>User</th>}
                    <th>Printer</th>
                    <th>State</th>
                    <th>Printer said</th>
                    <th>Created</th>
                    <th className="actions"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const isNew = !seenRef.current.has(job.id);
                    seenRef.current.add(job.id);
                    const detail = [
                      job.ippJobId !== null ? `IPP job ${job.ippJobId}` : null,
                      ...job.stateReasons,
                      job.stateMessage,
                      job.state === "retrying" && job.nextAttemptAt ? `retry ${job.attempts}/5 at ${formatTime(job.nextAttemptAt)}` : null,
                    ].filter(Boolean).join(" · ");
                    return (
                      <tr key={job.id} className={isNew ? "new" : undefined}>
                        <td className="num id muted">{job.id}</td>
                        <td className="primary">{job.filename}</td>
                        {showUser && <td className="user">{job.userName ?? "—"}</td>}
                        <td className="printer">{job.printerName ?? job.printerId}</td>
                        <td className="state"><StateBadge state={job.state} /></td>
                        <td className="meta" title={detail || undefined}>
                          {detail || "—"}
                          {job.error && <div className="danger-text">{job.error}</div>}
                        </td>
                        <td className="meta num created">{formatDate(job.createdAt)}</td>
                        <td className="actions">
                          {(ACTIVE_JOB_STATES as readonly string[]).includes(job.state) && (
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => cancel(job.id)}>Cancel</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
      </div>
    </div>
  );
}
