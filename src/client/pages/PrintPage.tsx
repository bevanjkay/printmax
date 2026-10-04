import type { FormEvent } from "react";
import type { DocumentSize, FormField, JobDto, PresetDto, PrinterDto, ValidationResult } from "../../shared/types.js";
import type { OptionValues } from "../components/OptionsForm.js";
import { useEffect, useRef, useState } from "react";
import { isPrimaryOption, isQuickOption } from "../../shared/attributes.js";
import { api } from "../api.js";
import { IconAlert, IconCheck, IconChevron, IconInfo, Spinner } from "../components/Icons.js";
import { JobsTable } from "../components/JobsTable.js";
import { OptionsForm } from "../components/OptionsForm.js";
import { Button, Dropzone, EmptyState, Field, Notice, Panel, SkeletonRows, StateBadge } from "../components/ui.js";
import { ValidationNotice } from "../components/Validation.js";
import { useChosenPrinter, useJobs } from "../hooks.js";
import { defaultsFrom, describeReason, jobReasons, pdfPageSize, remember, remembered, stateTone, summariseOptions, useAsyncError, useDebounced, useWarnBeforeLeaving } from "../util.js";

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

/** Where the preset last printed with on a printer is remembered, so the next job starts there. */
const presetKey = (printerId: number) => `printmax:preset:${printerId}`;

/** Keyed by printer id by the parent so options and presets reload when the printer changes; the file lives in the parent. */
function JobForm({ printer, printers, file, isAdmin, phase, onPrinterChange, onSending, onSubmitted, onFailed }: JobFormProps) {
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [presets, setPresets] = useState<PresetDto[]>([]);
  const [presetId, setPresetId] = useState<number | null>(null);
  const [options, setOptions] = useState<OptionValues>({});
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [documentSize, setDocumentSize] = useState<DocumentSize | null>(null);
  const { error, fail, clear } = useAsyncError();

  // Measured once per file, so the form can say a page will be cut before the job is sent.
  useEffect(() => {
    let cancelled = false;
    const measured = file ? file.arrayBuffer().then(bytes => pdfPageSize(new Uint8Array(bytes))) : Promise.resolve(null);
    measured.then(size => !cancelled && setDocumentSize(size)).catch(() => !cancelled && setDocumentSize(null));
    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getForm(printer.id), api.listPresets(printer.id)]).then(([f, p]) => {
      if (cancelled)
        return;
      setFields(f);
      setPresets(p);
      const usable = p.filter(x => x.problems.length === 0);
      const last = Number(remembered(presetKey(printer.id)));
      const first = usable.find(x => x.id === last) ?? usable[0];
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
    const { options: chosen, document } = current as { options: OptionValues; document?: DocumentSize };
    api.validate(printer.id, chosen, document).then(setValidation).catch(fail);
  }, { options, ...(documentSize ? { document: documentSize } : {}) }, 300);

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
    remember(presetKey(printer.id), String(presetId ?? ""));
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
  const quick = all.filter(f => isQuickOption(f.name) && f.name !== "copies");
  const finishing = all.filter(f => isPrimaryOption(f.name) && !isQuickOption(f.name));
  const finishingSummary = fields ? summariseOptions(fields, options, finishing.map(f => f.name), { changesOnly: true }) : "";
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
              <StateBadge state={printer.summary.state} />
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
                    {finishing.length > 0 && (
                      <details className="disclosure">
                        <summary>
                          <IconChevron className="icon chev" />
                          Finishing and paper
                          <span className="disclosure-note">{`· ${finishingSummary || "printer defaults"}`}</span>
                        </summary>
                        <div className="disclosure-body">
                          <OptionsForm fields={finishing} value={options} onChange={setOptions} friendly />
                        </div>
                      </details>
                    )}
                    {more.length > 0 && (
                      <details className="disclosure">
                        <summary>
                          <IconChevron className="icon chev" />
                          More options
                          <span className="disclosure-note">{`· ${more.length} more`}</span>
                        </summary>
                        <div className="disclosure-body">
                          <OptionsForm fields={more} value={options} onChange={setOptions} />
                        </div>
                      </details>
                    )}
                    {!hasPresets && (
                      <p className="help presets-hint">
                        {isAdmin
                          ? "No presets for this printer yet. Save the usual settings as a preset and printing becomes one choice."
                          : "No presets for this printer yet. An administrator can save the usual settings, such as a booklet, as a preset so printing becomes one choice."}
                      </p>
                    )}
                  </>
                )}

                {hasPresets && preset !== null && adjustable.length > 0 && (
                  <details className="disclosure">
                    <summary>
                      <IconChevron className="icon chev" />
                      Adjust this job
                      <span className="disclosure-note">· changes apply to this print only</span>
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
          {!file
            ? "Add a document above to print."
            : blocked
              ? "Fix the combination above to print."
              : summary ? `Will print ${summary}.` : "Ready to print."}
        </span>
        <Button type="submit" variant="primary" size="lg" disabled={!file || blocked || !fields}>Print</Button>
      </footer>
    </form>
  );
}

/** What became of the job, in the printer's terms but the user's words; a refusal never wears a tick. */
function SentJob({ job, printerName, onTryAgain, onChangeSettings, onPrintAnother }: { job: JobDto; printerName: string; onTryAgain: () => Promise<void>; onChangeSettings: () => void; onPrintAnother: (keepSettings: boolean) => void }) {
  const [retrying, setRetrying] = useState(false);
  const { error, fail } = useAsyncError();
  const tone = stateTone(job.state, job.stateReasons);
  const why = [...jobReasons(job.stateReasons), job.stateMessage, job.error].filter(Boolean).join(" · ");
  const failed = tone === "danger";
  const outcome = failed
    ? { icon: <IconAlert className="icon danger-text" />, title: "The printer couldn't print this", lede: `${job.filename} didn't print on ${printerName}.` }
    : tone === "warning"
      ? { icon: <IconAlert className="icon warning-text" />, title: "Waiting on the printer", lede: `${job.filename} is at ${printerName}, which has paused it.` }
      : job.state === "canceled"
        ? { icon: <IconInfo className="icon" />, title: "Cancelled", lede: `${job.filename} won't print on ${printerName}.` }
        : { icon: <IconCheck className="icon success-text" />, title: job.state === "completed" ? "Printed" : "Sent to the printer", lede: `${job.filename} went to ${printerName}.` };

  return (
    <EmptyState
      icon={outcome.icon}
      title={outcome.title}
      description={(
        <>
          {outcome.lede}
          <span className="empty-meta">
            <StateBadge state={job.state} reasons={job.stateReasons} />
            {why && <span className={failed ? "danger-text" : tone === "warning" ? "warning-text" : "muted"}>{why}</span>}
          </span>
          {error && <span className="empty-meta danger-text">{error}</span>}
        </>
      )}
      action={(
        <div className="row">
          {failed
            ? (
                <>
                  <Button
                    variant="primary"
                    loading={retrying}
                    onClick={() => {
                      setRetrying(true);
                      onTryAgain().catch(fail).finally(() => setRetrying(false));
                    }}
                  >
                    Try again
                  </Button>
                  <Button onClick={onChangeSettings}>Change settings</Button>
                </>
              )
            : <Button variant="primary" onClick={() => onPrintAnother(true)}>Print another with these settings</Button>}
          <Button onClick={() => onPrintAnother(false)}>Start a new job</Button>
        </div>
      )}
    />
  );
}

export function PrintPage({ printers, loading, jobsKey, isAdmin, onSubmitted, onGoToJobs }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [submitted, setSubmitted] = useState<JobDto | null>(null);
  // Kept after the form clears, so a job the printer refused can be sent again without choosing the file again.
  const [sentFile, setSentFile] = useState<File | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [printer, setSelectedId] = useChosenPrinter(printers);
  const { jobs, error, refresh } = useJobs({ all: false, limit: 5, refreshKey: jobsKey });
  // The job list is polling anyway, so the panel can follow the job the printer is actually doing.
  const live = submitted === null ? null : jobs?.find(j => j.id === submitted.id) ?? submitted;
  // Closing the tab mid-upload loses the job with no trace of it on either side.
  useWarnBeforeLeaving(phase === "sending");
  // The form, and the Print button with it, unmounts once the job goes out; focus follows the job instead of falling to the page.
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase !== "form")
      statusRef.current?.focus();
  }, [phase]);

  /** Back to the form, with the settings as they were or as the printer's presets have them. */
  function printAnother(keepSettings: boolean) {
    setSubmitted(null);
    setPhase("form");
    if (!keepSettings)
      setFormKey(k => k + 1);
  }

  /** The same document and settings again: from the copy the server kept, or back through the form with the file. */
  async function tryAgain(job: JobDto) {
    if (!job.fileRetained) {
      changeSettings();
      return;
    }
    setSubmitted(await api.reprintJob(job.id));
    onSubmitted();
    void refresh();
  }

  function changeSettings() {
    setFile(sentFile);
    printAnother(true);
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
            setSentFile(file);
            setFile(null);
            onSubmitted();
            void refresh();
          }}
          onFailed={() => setPhase("form")}
        />
        {phase === "sending" && (
          <div className="panel-body" role="status" aria-live="polite" ref={statusRef} tabIndex={-1}>
            <EmptyState
              icon={<Spinner />}
              title={file ? `Sending ${file.name}` : "Sending the document"}
              description={`Uploading it and queueing it on ${printer.name}. A large document takes a moment.`}
            />
          </div>
        )}
        {phase === "sent" && live && (
          <div className="panel-body" role="status" aria-live="polite" ref={statusRef} tabIndex={-1}>
            <SentJob key={live.id} job={live} printerName={printer.name} onTryAgain={() => tryAgain(live)} onChangeSettings={changeSettings} onPrintAnother={printAnother} />
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
