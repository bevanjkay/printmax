import type { FormEvent } from "react";
import type { FormField, JobDto, PresetDto, PrinterDto, ValidationResult } from "../../shared/types.js";
import type { OptionValues } from "../components/OptionsForm.js";
import { useEffect, useState } from "react";
import { isPrimaryOption } from "../../shared/attributes.js";
import { api } from "../api.js";
import { IconCheck, IconChevron, Spinner } from "../components/Icons.js";
import { JobsTable } from "../components/JobsTable.js";
import { OptionsForm } from "../components/OptionsForm.js";
import { Badge, Button, Dropzone, EmptyState, Field, Notice, Panel, SkeletonRows, StateBadge } from "../components/ui.js";
import { ValidationNotice } from "../components/Validation.js";
import { useJobs } from "../hooks.js";
import { defaultsFrom, describeReason, stateTone, summariseOptions, useAsyncError, useDebounced } from "../util.js";

interface Props {
  printers: PrinterDto[];
  loading: boolean;
  jobsKey: number;
  isAdmin: boolean;
  onSubmitted: () => void;
  onGoToJobs: () => void;
}

/** The form gives way to the job's own progress once it is sent, so nothing looks editable that isn't. */
type Phase = "form" | "sending" | "sent";

interface JobFormProps {
  printer: PrinterDto;
  printers: PrinterDto[];
  file: File | null;
  isAdmin: boolean;
  phase: Phase;
  onPrinterChange: (id: number) => void;
  onSending: () => void;
  onSubmitted: (job: JobDto) => void;
  onFailed: () => void;
}

const CUSTOM = "custom";

/** Keyed by printer id by the parent so options and presets reload when the printer changes; the file lives in the parent. */
function JobForm({ printer, printers, file, isAdmin, phase, onPrinterChange, onSending, onSubmitted, onFailed }: JobFormProps) {
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [presets, setPresets] = useState<PresetDto[]>([]);
  const [presetId, setPresetId] = useState<number | null>(null);
  const [options, setOptions] = useState<OptionValues>({});
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const { error, fail, clear } = useAsyncError();

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getForm(printer.id), api.listPresets(printer.id)]).then(([f, p]) => {
      if (cancelled)
        return;
      setFields(f);
      setPresets(p);
      const first = p.find(x => x.problems.length === 0);
      setPresetId(first?.id ?? null);
      setOptions(first ? { ...defaultsFrom(f), ...first.options } : defaultsFrom(f));
    }).catch(fail);
    return () => {
      cancelled = true;
    };
  }, [printer.id, fail]);

  useDebounced((current) => {
    if (!fields)
      return;
    api.validate(printer.id, current).then(setValidation).catch(fail);
  }, options, 300);

  function choosePreset(id: number | null) {
    if (!fields)
      return;
    const preset = presets.find(p => p.id === id);
    const copies = options.copies;
    setPresetId(preset ? preset.id : null);
    setOptions({ ...defaultsFrom(fields), ...(preset?.options ?? {}), ...(copies !== undefined ? { copies } : {}) });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file)
      return;
    clear();
    onSending();
    try {
      onSubmitted(await api.submitJob(printer.id, presetId, file, options));
    }
    catch (err) {
      fail(err);
      onFailed();
    }
  }

  const blocked = validation !== null && validation.errors.length > 0;
  const stopped = printer.summary.state === "stopped";
  const all = fields ?? [];
  const copiesField = all.filter(f => f.name === "copies");
  const primaryNames = all.filter(f => isPrimaryOption(f.name)).map(f => f.name);
  const quick = all.filter(f => isPrimaryOption(f.name) && f.name !== "copies");
  const more = all.filter(f => !isPrimaryOption(f.name));
  const adjustable = all.filter(f => f.name !== "copies");
  const hasPresets = presets.length > 0;
  const preset = presets.find(p => p.id === presetId) ?? null;
  const summary = fields ? summariseOptions(fields, options, primaryNames) : "";

  // Stays mounted while the job goes out, so "these settings" are still here to print another with.
  if (phase !== "form")
    return null;

  return (
    <form onSubmit={submit}>
      <div className="panel-body">
        <div className="two-col">
          <div>
            <Field label="Printer" className="compact">
              <select className="control" value={printer.id} onChange={e => onPrinterChange(Number(e.target.value))}>
                {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <div className="printer-state">
              <Badge tone={stateTone(printer.summary.state)}>{printer.summary.state}</Badge>
              {printer.location && <span>{printer.location}</span>}
              {printer.summary.stateReasons.map(describeReason).map(r => (
                <span key={r.text} className={r.severity === "error" ? "danger-text" : r.severity === "warning" ? "warning-text" : "muted"}>{r.text}</span>
              ))}
            </div>
            {stopped && <Notice tone="warning">This printer reports it is stopped. You can queue the job; it prints when the printer recovers.</Notice>}
          </div>
          {copiesField.length > 0 && <OptionsForm fields={copiesField} value={options} onChange={setOptions} friendly />}
        </div>
      </div>

      <div className="panel-body">
        {!fields
          ? <SkeletonRows rows={3} />
          : (
              <>
                {hasPresets && (
                  <div className="field">
                    <span className="field-label">How to print it</span>
                    <div className="preset-list" role="radiogroup" aria-label="Preset">
                      {presets.map(p => (
                        <label key={p.id} className={`preset-card${presetId === p.id ? " active" : ""}${p.problems.length > 0 ? " unavailable" : ""}`}>
                          <input type="radio" name="preset" value={p.id} checked={presetId === p.id} disabled={p.problems.length > 0} onChange={() => choosePreset(p.id)} />
                          <strong>{p.name}</strong>
                          <span>{p.problems.length > 0 ? "Needs attention; ask an admin" : (summariseOptions(fields, p.options, primaryNames, { changesOnly: true }) || "Printer defaults")}</span>
                          {p.problems.length === 0 && p.description && <span className="note">{p.description}</span>}
                        </label>
                      ))}
                      <label className={`preset-card${presetId === null ? " active" : ""}`}>
                        <input type="radio" name="preset" value={CUSTOM} checked={presetId === null} onChange={() => choosePreset(null)} />
                        <strong>Custom</strong>
                        <span>Choose the options yourself</span>
                      </label>
                    </div>
                  </div>
                )}

                {(!hasPresets || preset === null) && (
                  <>
                    {quick.length > 0 && <OptionsForm fields={quick} value={options} onChange={setOptions} friendly />}
                    {more.length > 0 && (
                      <details className="disclosure">
                        <summary>
                          <IconChevron className="icon chev" />
                          More options
                          <span className="muted" style={{ fontWeight: 400 }}>{`· ${more.length} more the printer supports`}</span>
                        </summary>
                        <div className="disclosure-body">
                          <OptionsForm fields={more} value={options} onChange={setOptions} />
                        </div>
                      </details>
                    )}
                    {!hasPresets && isAdmin && (
                      <p className="help" style={{ marginTop: 8 }}>No presets for this printer yet. Save the usual settings as a preset and printing becomes one choice.</p>
                    )}
                  </>
                )}

                {hasPresets && preset !== null && adjustable.length > 0 && (
                  <details className="disclosure">
                    <summary>
                      <IconChevron className="icon chev" />
                      Adjust this job
                      <span className="muted" style={{ fontWeight: 400 }}>· changes apply to this print only</span>
                    </summary>
                    <div className="disclosure-body">
                      <OptionsForm fields={adjustable} value={options} onChange={setOptions} />
                    </div>
                  </details>
                )}

                <ValidationNotice result={validation} value={options} onApply={setOptions} />
                {error && <Notice tone="error">{error}</Notice>}
              </>
            )}
      </div>

      <footer className="panel-footer">
        <span className="status">
          {file
            ? <span>{summary ? `Will print ${summary}.` : "Ready to print."}</span>
            : "Add a document above to print."}
        </span>
        <Button type="submit" variant="primary" size="lg" disabled={!file || blocked || !fields}>Print</Button>
      </footer>
    </form>
  );
}

export function PrintPage({ printers, loading, jobsKey, isAdmin, onSubmitted, onGoToJobs }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [submitted, setSubmitted] = useState<JobDto | null>(null);
  const [formKey, setFormKey] = useState(0);
  const printer = printers.find(p => p.id === selectedId) ?? printers[0];
  const { jobs, error, refresh } = useJobs({ all: false, limit: 5, refreshKey: jobsKey });
  // The job list is polling anyway, so the panel can follow the job the printer is actually doing.
  const live = submitted === null ? null : jobs?.find(j => j.id === submitted.id) ?? submitted;

  /** Back to the form, with the settings as they were or as the printer's presets have them. */
  function printAnother(keepSettings: boolean) {
    setSubmitted(null);
    setPhase("form");
    if (!keepSettings)
      setFormKey(k => k + 1);
  }

  if (loading)
    return <Panel><SkeletonRows rows={4} /></Panel>;

  if (!printer) {
    return (
      <Panel>
        <div className="empty">
          <h3>No printers yet</h3>
          <p>An administrator adds printers under Printers. Once one exists, this page is where you print.</p>
        </div>
      </Panel>
    );
  }

  return (
    <div className="stack">
      <Panel>
        {phase === "form" && (
          <div className="panel-body">
            <div className="field compact">
              <span className="field-label">Document</span>
              <Dropzone file={file} onFile={setFile} accept="application/pdf,image/png,image/jpeg" />
            </div>
          </div>
        )}
        <JobForm
          key={`${printer.id}-${formKey}`}
          printer={printer}
          printers={printers}
          file={file}
          isAdmin={isAdmin}
          phase={phase}
          onPrinterChange={setSelectedId}
          onSending={() => setPhase("sending")}
          onSubmitted={(job) => {
            setSubmitted(job);
            setPhase("sent");
            setFile(null);
            onSubmitted();
            void refresh();
          }}
          onFailed={() => setPhase("form")}
        />
        {phase === "sending" && (
          <div className="panel-body" role="status" aria-live="polite">
            <EmptyState
              icon={<Spinner />}
              title={file ? `Sending ${file.name}` : "Sending the document"}
              description={`Uploading it and queueing it on ${printer.name}. A large document takes a moment.`}
            />
          </div>
        )}
        {phase === "sent" && live && (
          <div className="panel-body" role="status" aria-live="polite">
            <EmptyState
              icon={<IconCheck className="icon success-text" />}
              title={live.state === "completed" ? "Printed" : "Job submitted"}
              description={(
                <>
                  {`${live.filename} went to ${printer.name}.`}
                  <span className="empty-meta">
                    <StateBadge state={live.state} reasons={live.stateReasons} />
                    {live.error && <span className="danger-text">{live.error}</span>}
                  </span>
                </>
              )}
              action={(
                <div className="row">
                  <Button variant="primary" onClick={() => printAnother(true)}>Print another with these settings</Button>
                  <Button onClick={() => printAnother(false)}>Start a new job</Button>
                </div>
              )}
            />
          </div>
        )}
      </Panel>
      <div>
        <div className="section-title">
          <h2>Recent jobs</h2>
          <Button variant="ghost" size="sm" onClick={onGoToJobs}>All jobs</Button>
        </div>
        <JobsTable canShare={isAdmin} jobs={jobs} error={error} onChanged={refresh} emptyTitle="Nothing printed yet" emptyDescription="Your jobs appear here as soon as you print." />
      </div>
    </div>
  );
}
