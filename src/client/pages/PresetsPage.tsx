import type { FormEvent } from "react";
import type { FormField, PresetDto, PrinterDto, UserDto, ValidationResult } from "../../shared/types.js";
import type { OptionValues } from "../components/OptionsForm.js";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { ConfirmButton } from "../components/ConfirmButton.js";
import { OptionsForm } from "../components/OptionsForm.js";
import { ValidationNotice } from "../components/Validation.js";
import { useAsyncError, useDebounced } from "../util.js";

interface Props {
  user: UserDto;
  printers: PrinterDto[];
}

interface EditorProps {
  user: UserDto;
  printer: PrinterDto;
  fields: FormField[];
  preset: PresetDto | null;
  onSaved: () => void;
  onCancel: () => void;
}

function PresetEditor({ user, printer, fields, preset, onSaved, onCancel }: EditorProps) {
  const [name, setName] = useState(preset?.name ?? "");
  const [description, setDescription] = useState(preset?.description ?? "");
  const [scope, setScope] = useState<"global" | "user">(preset?.scope ?? (user.role === "admin" ? "global" : "user"));
  const [options, setOptions] = useState<OptionValues>(preset?.options ?? {});
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const { error, fail, clear } = useAsyncError();

  useDebounced((current) => {
    api.validate(printer.id, current).then(setValidation).catch(fail);
  }, options, 300);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    clear();
    try {
      const input = { printerId: printer.id, name, description, scope, options };
      if (preset)
        await api.updatePreset(preset.id, input);
      else
        await api.createPreset(input);
      onSaved();
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
      <h3>{preset ? `Edit “${preset.name}”` : "New preset"}</h3>
      <div className="row">
        <label>
          Name
          <input required value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label>
          Description
          <input value={description} onChange={e => setDescription(e.target.value)} />
        </label>
      </div>
      {user.role === "admin" && (
        <label>
          Visibility
          <select value={scope} onChange={e => setScope(e.target.value as "global" | "user")}>
            <option value="global">Shared with everyone</option>
            <option value="user">Only me</option>
          </select>
        </label>
      )}
      <p className="muted small">Only set the options this preset should fix; everything else follows the printer's defaults.</p>
      <OptionsForm fields={fields} value={options} onChange={setOptions} />
      <ValidationNotice result={validation} value={options} onApply={setOptions} />
      <div className="row">
        <button disabled={busy || !name || (validation?.errors.length ?? 0) > 0}>{busy ? "Saving…" : "Save preset"}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export function PresetsPage({ user, printers }: Props) {
  const [printerId, setPrinterId] = useState<number | null>(null);
  const printer = printers.find(p => p.id === printerId) ?? printers[0];
  const [presets, setPresets] = useState<PresetDto[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [editing, setEditing] = useState<PresetDto | null | "new">(null);
  const { error, fail, clear } = useAsyncError();

  const refresh = useCallback(async () => {
    if (!printer)
      return;
    try {
      const [p, f] = await Promise.all([api.listPresets(printer.id), api.getForm(printer.id)]);
      setPresets(p);
      setFields(f);
      clear();
    }
    catch (err) {
      fail(err);
    }
  }, [printer, fail, clear]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function remove(preset: PresetDto) {
    clear();
    try {
      await api.deletePreset(preset.id);
      await refresh();
    }
    catch (err) {
      fail(err);
    }
  }

  if (!printer)
    return <p className="muted">Add a printer first.</p>;

  return (
    <>
      <div className="row">
        <label>
          Printer
          <select
            value={printer.id}
            onChange={(e) => {
              setPrinterId(Number(e.target.value));
              setEditing(null);
            }}
          >
            {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button onClick={() => setEditing("new")} disabled={editing === "new"}>New preset</button>
      </div>
      {error && <p className="error">{error}</p>}

      {editing !== null && (
        <PresetEditor
          key={editing === "new" ? "new" : editing.id}
          user={user}
          printer={printer}
          fields={fields}
          preset={editing === "new" ? null : editing}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {presets.length === 0
        ? <p className="muted">No presets for this printer yet.</p>
        : presets.map(p => (
            <div key={p.id} className="card">
              <h3>
                {p.name}
                {" "}
                <span className="state">{p.scope === "global" ? "shared" : "mine"}</span>
              </h3>
              {p.description && <p className="muted">{p.description}</p>}
              <dl>
                {Object.entries(p.options).map(([k, v]) => (
                  <div key={k} className="pair">
                    <dt>{fields.find(f => f.name === k)?.label ?? k}</dt>
                    <dd>{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
                  </div>
                ))}
              </dl>
              {p.problems.length > 0 && (
                <p className="error small">
                  Needs attention:
                  {" "}
                  {p.problems.join("; ")}
                </p>
              )}
              {p.editable && (
                <div className="row">
                  <button className="small" onClick={() => setEditing(p)}>Edit</button>
                  <ConfirmButton className="danger small" label="Delete" onConfirm={() => void remove(p)} />
                </div>
              )}
            </div>
          ))}
    </>
  );
}
