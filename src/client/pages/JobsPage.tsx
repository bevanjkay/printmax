import type { JobDto, UserDto } from "../../shared/types.js";
import { useState } from "react";
import { ACTIVE_JOB_STATES } from "../../shared/types.js";
import { IconSearch } from "../components/Icons.js";
import { JobsTable } from "../components/JobsTable.js";
import { useJobs } from "../hooks.js";
import { stateTone } from "../util.js";

interface Props {
  user: UserDto;
  refreshKey: number;
}

type Show = "all" | "active" | "problems";

const SHOW: Array<{ id: Show; label: string; keep: (job: JobDto) => boolean }> = [
  { id: "all", label: "All", keep: () => true },
  { id: "active", label: "In progress", keep: job => (ACTIVE_JOB_STATES as readonly string[]).includes(job.state) },
  { id: "problems", label: "Problems", keep: job => ["danger", "warning"].includes(stateTone(job.state, job.stateReasons)) },
];

export function JobsPage({ user, refreshKey }: Props) {
  const [all, setAll] = useState(false);
  const [show, setShow] = useState<Show>("all");
  const [query, setQuery] = useState("");
  const { jobs, error, refresh } = useJobs({ all, refreshKey });
  const needle = query.trim().toLowerCase();
  const keep = SHOW.find(s => s.id === show)!.keep;
  const filtered = jobs?.filter(job => keep(job) && (!needle || [job.filename, job.printerName, job.userName].some(v => v?.toLowerCase().includes(needle)))) ?? null;
  const narrowed = show !== "all" || needle !== "";

  return (
    <div className="stack">
      <div className="toolbar">
        {user.role === "admin" && (
          <div className="segmented" role="group" aria-label="Whose jobs">
            <button type="button" className={all ? "" : "active"} aria-pressed={!all} onClick={() => setAll(false)}>Mine</button>
            <button type="button" className={all ? "active" : ""} aria-pressed={all} onClick={() => setAll(true)}>Everyone</button>
          </div>
        )}
        <div className="segmented" role="group" aria-label="Which jobs">
          {SHOW.map(s => (
            <button key={s.id} type="button" className={show === s.id ? "active" : ""} aria-pressed={show === s.id} onClick={() => setShow(s.id)}>{s.label}</button>
          ))}
        </div>
        <div className="search">
          <IconSearch className="icon" />
          <input className="control" type="search" aria-label="Search jobs" placeholder={all ? "Document, printer or person" : "Document or printer"} value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <span className="help">Updates every few seconds.</span>
      </div>
      <JobsTable
        jobs={filtered}
        error={error}
        showUser={all}
        canShare={user.role === "admin"}
        onChanged={refresh}
        {...(narrowed && jobs && jobs.length > 0 ? { emptyTitle: "No jobs match", emptyDescription: "Try another word, or show all jobs." } : {})}
      />
    </div>
  );
}
