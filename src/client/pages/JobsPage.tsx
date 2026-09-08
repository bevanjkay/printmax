import type { UserDto } from "../../shared/types.js";
import { useState } from "react";
import { JobsTable } from "../components/JobsTable.js";
import { useJobs } from "../hooks.js";

interface Props {
  user: UserDto;
  refreshKey: number;
}

export function JobsPage({ user, refreshKey }: Props) {
  const [all, setAll] = useState(false);
  const { jobs, error, refresh } = useJobs({ all, refreshKey });

  return (
    <div className="stack">
      {user.role === "admin" && (
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Whose jobs">
            <button type="button" className={all ? "" : "active"} onClick={() => setAll(false)}>Mine</button>
            <button type="button" className={all ? "active" : ""} onClick={() => setAll(true)}>Everyone</button>
          </div>
          <span className="help">Updates every few seconds.</span>
        </div>
      )}
      <JobsTable jobs={jobs} error={error} showUser={all} canShare={user.role === "admin"} onChanged={refresh} />
    </div>
  );
}
