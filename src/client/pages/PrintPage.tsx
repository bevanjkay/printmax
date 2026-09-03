import type { FormEvent } from "react";
import type { FormField, PresetDto, PrinterDto, ValidationResult } from "../../shared/types.js";
import type { OptionValues } from "../components/OptionsForm.js";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { OptionsForm } from "../components/OptionsForm.js";
import { ValidationNotice } from "../components/Validation.js";
import { defaultsFrom, useAsyncError, useDebounced } from "../util.js";

interface Props {
  printers: PrinterDto[];
  onSubmitted: () => void;
}

/** Keyed by printer id by the parent so all state resets when the printer changes. */
function PrinterJobForm({ printer, onSubmitted }: { printer: PrinterDto; onSubmitted: () => void }) {
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [presets, setPresets] = useState<PresetDto[]>([]);
  const [presetId, setPresetId] = useState<number | null>(null);
  const [options, setOptions] = useState<OptionValues>({});
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
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
      setOptions(defaultsFrom(f));
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
    setPresetId(id);
    if (!fields)
      return;
    const preset = presets.find(p => p.id === id);
    setOptions(preset ? { ...defaultsFrom(fields), ...preset.options } : defaultsFrom(fields));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file)
      return;
    const form = e.target as HTMLFormElement;
    setBusy(true);
    clear();
    setDone(null);
    try {
      const job = await api.submitJob(printer.id, presetId, file, options);
      setFile(null);
      form.reset();
      setDone(`Sent ${job.filename} to ${printer.name}.`);
      onSubmitted();
    }
    catch (err) {
      fail(err);
    }
    finally {
      setBusy(false);
    }
  }

  if (!fields)
    return <p className="muted">Loading printer options…</p>;

  const blocked = validation !== null && validation.errors.length > 0;
  return (
    <form onSubmit={submit}>
      <label>
        Preset
        <select value={presetId ?? ""} onChange={e => choosePreset(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Printer defaults</option>
          {presets.map(p => (
            <option key={p.id} value={p.id} disabled={p.problems.length > 0}>
              {p.name}
              {p.scope === "user" ? " (mine)" : ""}
              {p.problems.length > 0 ? " — needs attention" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Document (PDF, PNG or JPEG)
        <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <details open={presetId === null}>
        <summary>
          Options
          {presetId !== null ? " (adjust the preset for this job)" : ""}
        </summary>
        <OptionsForm fields={fields} value={options} onChange={setOptions} />
      </details>
      <ValidationNotice result={validation} value={options} onApply={setOptions} />
      <div className="row">
        <button disabled={busy || !file || blocked}>{busy ? "Sending…" : "Print"}</button>
        {done && <span className="ok">{done}</span>}
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export function PrintPage({ printers, onSubmitted }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const printer = printers.find(p => p.id === selectedId) ?? printers[0];

  if (!printer)
    return <p className="muted">No printers have been added yet. An admin can add one under Printers.</p>;

  return (
    <div className="card">
      <label>
        Printer
        <select value={printer.id} onChange={e => setSelectedId(Number(e.target.value))}>
          {printers.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.summary.state !== "idle" ? ` (${p.summary.state})` : ""}
            </option>
          ))}
        </select>
      </label>
      {printer.summary.stateReasons.length > 0 && <p className="warn">{printer.summary.stateReasons.join(", ")}</p>}
      <PrinterJobForm key={printer.id} printer={printer} onSubmitted={onSubmitted} />
    </div>
  );
}
