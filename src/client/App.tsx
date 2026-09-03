import type { FormEvent } from "react";
import type { JobDto, PrinterDto } from "../shared/types.js";
import { useCallback, useEffect, useState } from "react";
import { ACTIVE_JOB_STATES } from "../shared/types.js";
import { api } from "./api.js";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

function useAsyncError(): { error: string | null; fail: (e: unknown) => void; clear: () => void } {
  const [error, setError] = useState<string | null>(null);
  const fail = useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), []);
  const clear = useCallback(() => setError(null), []);
  return { error, fail, clear };
}

function AddPrinter({ onAdded }: { onAdded: () => void }) {
  const [uri, setUri] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { error, fail, clear } = useAsyncError();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    clear();
    try {
      await api.addPrinter({ uri, name: name || undefined, username: username || undefined, password: password || undefined });
      setUri("");
      setName("");
      setUsername("");
      setPassword("");
      onAdded();
    }
    catch (err) {
      fail(err);
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>Add printer</h3>
      <label>
        IPP URI
        <input required placeholder="ipp://192.168.0.50/ipp/print" value={uri} onChange={e => setUri(e.target.value)} />
      </label>
      <label>
        Name (optional)
        <input value={name} onChange={e => setName(e.target.value)} />
      </label>
      <div className="row">
        <label>
          Username
          <input autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
        </label>
      </div>
      <button disabled={busy || !uri}>{busy ? "Querying printer…" : "Add"}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function PrinterCard({ printer, onChanged }: { printer: PrinterDto; onChanged: () => void }) {
  const { error, fail, clear } = useAsyncError();
  const s = printer.summary;
  async function run(action: () => Promise<unknown>) {
    clear();
    try {
      await action();
      onChanged();
    }
    catch (err) {
      fail(err);
    }
  }
  return (
    <div className="card">
      <h3>
        {printer.name}
        {" "}
        <span className={`state state-${s.state}`}>{s.state}</span>
      </h3>
      <p className="muted">
        {printer.makeModel ?? "unknown model"}
        {printer.location ? ` · ${printer.location}` : ""}
        {" · "}
        <code>{printer.uri}</code>
      </p>
      {s.stateReasons.length > 0 && <p className="warn">{s.stateReasons.join(", ")}</p>}
      <dl>
        <dt>Formats</dt>
        <dd>{s.documentFormats.join(", ") || "—"}</dd>
        <dt>Sides</dt>
        <dd>{s.sides.join(", ") || "—"}</dd>
        <dt>Colour</dt>
        <dd>{s.colorModes.join(", ") || "—"}</dd>
        <dt>Media</dt>
        <dd>{s.media.join(", ") || "—"}</dd>
        <dt>Finishings</dt>
        <dd>{s.finishings.join(", ") || "—"}</dd>
        <dt>Job accounting</dt>
        <dd>{s.jobAccountIdSupported ? "job-account-id supported" : "not advertised"}</dd>
        <dt>Caps fetched</dt>
        <dd>{printer.capsFetchedAt ? formatDate(printer.capsFetchedAt) : "never"}</dd>
      </dl>
      <div className="row">
        <button onClick={() => run(() => api.refreshPrinter(printer.id))}>Re-fetch capabilities</button>
        <button className="danger" onClick={() => run(() => api.deletePrinter(printer.id))}>Remove</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Keyed by printer id by its parent so option state resets when the printer changes. */
function JobForm({ printer, onSubmitted }: { printer: PrinterDto; onSubmitted: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<Record<string, string | number>>(() => ({ ...printer.summary.defaults }));
  const [busy, setBusy] = useState(false);
  const { error, fail, clear } = useAsyncError();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file)
      return;
    const form = e.target as HTMLFormElement;
    setBusy(true);
    clear();
    try {
      await api.submitJob(printer.id, file, options);
      setFile(null);
      form.reset();
      onSubmitted();
    }
    catch (err) {
      fail(err);
    }
    finally {
      setBusy(false);
    }
  }

  const select = (key: string, label: string, choices: string[]) => choices.length > 0 && (
    <label key={key}>
      {label}
      <select value={String(options[key] ?? "")} onChange={e => setOptions({ ...options, [key]: e.target.value })}>
        {choices.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );

  return (
    <form onSubmit={submit}>
      <label>
        Document (PDF, PNG or JPEG)
        <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <div className="options">
        {select("sides", "Sides", printer.summary.sides)}
        {select("print-color-mode", "Colour", printer.summary.colorModes)}
        {select("media", "Media", printer.summary.media)}
        {select("media-source", "Tray", printer.summary.mediaSources)}
        {select("print-quality", "Quality", printer.summary.printQuality)}
        {select("finishings", "Finishing", printer.summary.finishings)}
        <label>
          Copies
          <input
            type="number"
            min={1}
            max={printer.summary.copiesMax}
            value={Number(options.copies ?? 1)}
            onChange={e => setOptions({ ...options, copies: Number(e.target.value) })}
          />
        </label>
      </div>
      <button disabled={busy || !file}>{busy ? "Sending…" : "Print"}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function PrintForm({ printers, onSubmitted }: { printers: PrinterDto[]; onSubmitted: () => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const printer = printers.find(p => p.id === selectedId) ?? printers[0];
  if (!printer)
    return null;

  return (
    <div className="card">
      <h3>Print</h3>
      <label>
        Printer
        <select value={printer.id} onChange={e => setSelectedId(Number(e.target.value))}>
          {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <JobForm key={printer.id} printer={printer} onSubmitted={onSubmitted} />
    </div>
  );
}

function JobsTable({ jobs, onChanged }: { jobs: JobDto[]; onChanged: () => void }) {
  const { error, fail, clear } = useAsyncError();
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
  if (jobs.length === 0)
    return <p className="muted">No jobs yet.</p>;
  return (
    <>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>File</th>
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
    </>
  );
}

export function App() {
  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const { error, fail, clear } = useAsyncError();

  const refreshPrinters = useCallback(async () => {
    try {
      setPrinters(await api.listPrinters());
      clear();
    }
    catch (err) {
      fail(err);
    }
  }, [clear, fail]);

  const refreshJobs = useCallback(async () => {
    try {
      setJobs(await api.listJobs());
    }
    catch (err) {
      fail(err);
    }
  }, [fail]);

  useEffect(() => {
    void refreshPrinters();
    void refreshJobs();
    const timer = setInterval(() => void refreshJobs(), 3000);
    return () => clearInterval(timer);
  }, [refreshPrinters, refreshJobs]);

  return (
    <main>
      <header>
        <h1>printmax</h1>
        <p className="muted">Upload a document, pick a printer, print. Talks IPP directly.</p>
      </header>
      {error && <p className="error">{error}</p>}
      <section className="grid">
        <div>
          <h2>Printers</h2>
          {printers.map(p => <PrinterCard key={p.id} printer={p} onChanged={refreshPrinters} />)}
          <AddPrinter onAdded={refreshPrinters} />
        </div>
        <div>
          <h2>Print</h2>
          {printers.length === 0 ? <p className="muted">Add a printer first.</p> : <PrintForm printers={printers} onSubmitted={refreshJobs} />}
        </div>
      </section>
      <section>
        <h2>Jobs</h2>
        <JobsTable jobs={jobs} onChanged={refreshJobs} />
      </section>
    </main>
  );
}
