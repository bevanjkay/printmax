import type { FormEvent } from "react";
import type { JobDto } from "../../shared/types.js";
import { useEffect, useRef, useState } from "react";
import { ACTIVE_JOB_STATES } from "../../shared/types.js";
import { api } from "../api.js";
import { formatDate, formatTime, useAsyncError } from "../util.js";
import { IconInbox, IconLibrary, IconRefresh } from "./Icons.js";
import { Button, EmptyState, Notice, NumberInput, SkeletonRows, StateBadge } from "./ui.js";

/** Same document, same settings, a chosen number of copies: proof one, then run the rest. */
function Reprint({ job, onDone, onError }: { job: JobDto; onDone: () => void; onError: (err: unknown) => void }) {
  const [copies, setCopies] = useState(Number(job.options.copies ?? 1) || 1);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.reprintJob(job.id, copies);
      onDone();
    }
    catch (err) {
      onError(err);
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <NumberInput min={1} max={999} style={{ width: 76 }} aria-label={`Copies of ${job.filename}`} autoFocus value={copies} onChange={setCopies} />
      <Button type="submit" size="sm" variant="primary" loading={busy}>{copies === 1 ? "Print 1 copy" : `Print ${copies} copies`}</Button>
      <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
    </form>
  );
}

/** Keeps a printed job in the library under a name, with the preset it printed with. */
function Keep({ job, canShare, onDone, onError }: { job: JobDto; canShare: boolean; onDone: (name: string) => void; onError: (err: unknown) => void }) {
  const [name, setName] = useState(job.filename.replace(/\.[a-z0-9]+$/i, ""));
  const [scope, setScope] = useState<"global" | "user">(canShare ? "global" : "user");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.keepJob(job.id, { name, scope });
      onDone(name);
    }
    catch (err) {
      onError(err);
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <input className="control" required style={{ width: 150 }} aria-label="Library name" autoFocus value={name} onChange={e => setName(e.target.value)} />
      {canShare && (
        <select className="control" aria-label="Who can use it" value={scope} onChange={e => setScope(e.target.value as "global" | "user")}>
          <option value="global">Everyone</option>
          <option value="user">Only me</option>
        </select>
      )}
      <Button type="submit" size="sm" variant="primary" loading={busy}>Keep</Button>
      <Button size="sm" variant="ghost" onClick={() => onDone("")}>Cancel</Button>
    </form>
  );
}

interface Props {
  jobs: JobDto[] | null;
  error: string | null;
  showUser?: boolean;
  /** Admins can keep a job for everyone; others keep it for themselves. */
  canShare?: boolean;
  onChanged: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function JobsTable({ jobs, error, showUser, canShare = false, onChanged, emptyTitle = "No jobs yet", emptyDescription = "Jobs you print will show up here with what the printer said about them." }: Props) {
  const { error: actionError, fail, clear } = useAsyncError();
  const [reprinting, setReprinting] = useState<number | null>(null);
  const [keeping, setKeeping] = useState<number | null>(null);
  const [kept, setKept] = useState<string | null>(null);
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
      {kept && <Notice tone="success">{`${kept} is in the Library.`}</Notice>}
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
                      job.state === "retrying" && job.nextAttemptAt ? `retrying at ${formatTime(job.nextAttemptAt)} (${job.attempts} so far)` : null,
                    ].filter(Boolean).join(" · ");
                    return (
                      <tr key={job.id} className={isNew ? "new" : undefined}>
                        <td className="num id muted">{job.id}</td>
                        <td className="primary">{job.filename}</td>
                        {showUser && <td className="user">{job.userName ?? "—"}</td>}
                        <td className="printer">{job.printerName ?? job.printerId}</td>
                        <td className="state"><StateBadge state={job.state} reasons={job.stateReasons} /></td>
                        <td className="meta" title={detail || undefined}>
                          {detail || "—"}
                          {job.error && <div className="danger-text">{job.error}</div>}
                        </td>
                        <td className="meta num created">{formatDate(job.createdAt)}</td>
                        <td className="actions">
                          {keeping === job.id && (
                            <Keep
                              job={job}
                              canShare={canShare}
                              onDone={(name) => {
                                setKeeping(null);
                                if (name)
                                  setKept(name);
                              }}
                              onError={(err) => {
                                setKeeping(null);
                                fail(err);
                              }}
                            />
                          )}
                          {reprinting === job.id && (
                            <Reprint
                              job={job}
                              onDone={() => {
                                setReprinting(null);
                                onChanged();
                              }}
                              onError={(err) => {
                                setReprinting(null);
                                fail(err);
                              }}
                            />
                          )}
                          {keeping !== job.id && reprinting !== job.id && (
                            <>
                              {job.fileRetained && (
                                <Button
                                  size="sm"
                                  icon={<IconRefresh />}
                                  onClick={() => {
                                    clear();
                                    setReprinting(job.id);
                                  }}
                                >
                                  Print again
                                </Button>
                              )}
                              {job.fileRetained && (
                                <Button
                                  size="sm"
                                  icon={<IconLibrary />}
                                  onClick={() => {
                                    clear();
                                    setKept(null);
                                    setKeeping(job.id);
                                  }}
                                >
                                  Keep
                                </Button>
                              )}
                              {(ACTIVE_JOB_STATES as readonly string[]).includes(job.state) && (
                                <button type="button" className="btn btn-sm btn-danger" onClick={() => cancel(job.id)}>Cancel</button>
                              )}
                            </>
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
