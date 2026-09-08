import type { FormEvent } from "react";
import type { FormField, PresetDto, PrinterDto, ValidationResult } from "../../shared/types.js";
import type { OptionValues } from "../components/OptionsForm.js";
import { useEffect, useState } from "react";
import { isPrimaryOption } from "../../shared/attributes.js";
import { api } from "../api.js";
import { IconChevron } from "../components/Icons.js";
import { JobsTable } from "../components/JobsTable.js";
import { OptionsForm } from "../components/OptionsForm.js";
import { Badge, Button, Dropzone, Field, Notice, Panel, SkeletonRows } from "../components/ui.js";
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

interface JobFormProps {
  printer: PrinterDto;
  printers: PrinterDto[];
  file: File | null;
  isAdmin: boolean;
  onPrinterChange: (id: number) => void;
  onSubmitted: () => void;
}

const CUSTOM = "custom";

/** Keyed by printer id by the parent so options and presets reload when the printer changes; the file lives in the parent. */
function JobForm({ printer, printers, file, isAdmin, onPrinterChange, onSubmitted }: JobFormProps) {
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [presets, setPresets] = useState<PresetDto[]>([]);
  const [presetId, setPresetId] = useState<number | null>(null);
  const [options, setOptions] = useState<OptionValues>({});
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
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
    setBusy(true);
    clear();
    setDone(null);
    try {
      const job = await api.submitJob(printer.id, presetId, file, options);
      setDone(`${job.filename} is on its way to ${printer.name}.`);
      onSubmitted();
    }
    catch (err) {
      fail(err);
    }
    finally {
      setBusy(false);
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
          {done
            ? <span className="success-text">{done}</span>
            : file
              ? <span>{summary ? `Will print ${summary}.` : "Ready to print."}</span>
              : "Add a document above to print."}
        </span>
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!file || blocked || !fields}>
          {busy ? "Sending" : "Print"}
        </Button>
      </footer>
    </form>
  );
}

export function PrintPage({ printers, loading, jobsKey, isAdmin, onSubmitted, onGoToJobs }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const printer = printers.find(p => p.id === selectedId) ?? printers[0];
  const { jobs, error, refresh } = useJobs({ all: false, limit: 5, refreshKey: jobsKey });

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
        <div className="panel-body">
          <div className="field compact">
            <span className="field-label">Document</span>
            <Dropzone file={file} onFile={setFile} accept="application/pdf,image/png,image/jpeg" />
          </div>
        </div>
        <JobForm
          key={printer.id}
          printer={printer}
          printers={printers}
          file={file}
          isAdmin={isAdmin}
          onPrinterChange={setSelectedId}
          onSubmitted={() => {
            setFile(null);
            onSubmitted();
            void refresh();
          }}
        />
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
