import type { FormEvent } from "react";
import type { FormField, PresetDto, PresetExportItem, PresetImportResult, PrinterDto, UserDto, ValidationResult } from "../../shared/types.js";
import type { OptionValues } from "../components/OptionsForm.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { ConfirmButton } from "../components/ConfirmButton.js";
import { IconDownload, IconPlus, IconPresets, IconUpload } from "../components/Icons.js";
import { OptionsForm } from "../components/OptionsForm.js";
import { Badge, Button, EmptyState, Field, Notice, Panel, SkeletonRows } from "../components/ui.js";
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

  const chosen = Object.keys(options).length;

  return (
    <form onSubmit={submit}>
      <Panel
        title={preset ? `Edit ${preset.name}` : "New preset"}
        footer={(
          <>
            <span className="status">
              {chosen === 0 ? "Choose the settings this preset should fix." : `${chosen} setting${chosen === 1 ? "" : "s"} fixed; everything else follows the printer's defaults.`}
            </span>
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!name || (validation?.errors.length ?? 0) > 0}>Save preset</Button>
          </>
        )}
      >
        <div className="panel-body">
          <div className="two-col">
            <Field label="Name">
              <input className="control" required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Double-sided draft" />
            </Field>
            <Field label="Description" hint="Optional. Shown next to the name.">
              <input className="control" value={description} onChange={e => setDescription(e.target.value)} />
            </Field>
          </div>
          {user.role === "admin" && (
            <Field label="Who can use it">
              <select className="control" value={scope} onChange={e => setScope(e.target.value as "global" | "user")}>
                <option value="global">Everyone</option>
                <option value="user">Only me</option>
              </select>
            </Field>
          )}
        </div>
        <div className="panel-body">
          <OptionsForm fields={fields} value={options} onChange={setOptions} />
          <ValidationNotice result={validation} value={options} onApply={setOptions} />
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </Panel>
    </form>
  );
}

/** Accepts a printmax preset file, or a bare array of presets. */
function presetsInFile(text: string): PresetExportItem[] {
  const parsed: unknown = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : (parsed as { presets?: unknown } | null)?.presets;
  if (!Array.isArray(items))
    throw new Error("That file is not a printmax preset export.");
  return items as PresetExportItem[];
}

function download(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function optionLabel(fields: FormField[], key: string): string {
  return fields.find(f => f.name === key)?.label ?? key;
}

function optionValueLabel(fields: FormField[], key: string, value: unknown): string {
  const field = fields.find(f => f.name === key);
  const values = Array.isArray(value) ? value : [value];
  return values.map(v => field?.choices?.find(c => String(c.value) === String(v))?.label ?? String(v)).join(", ");
}

export function PresetsPage({ user, printers }: Props) {
  const [printerId, setPrinterId] = useState<number | null>(null);
  const printer = printers.find(p => p.id === printerId) ?? printers[0];
  const [presets, setPresets] = useState<PresetDto[] | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [editing, setEditing] = useState<PresetDto | null | "new">(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<PresetImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  async function importFile(file: File) {
    clear();
    setImported(null);
    setImporting(true);
    try {
      const result = await api.importPresets(printer!.id, presetsInFile(await file.text()));
      setImported(result);
      await refresh();
    }
    catch (err) {
      fail(err);
    }
    finally {
      setImporting(false);
    }
  }

  async function exportAll() {
    clear();
    try {
      const file = await api.exportPresets(printer!.id);
      download(`${printer!.name.replace(/[^\w-]+/g, "-").toLowerCase()}-presets.json`, file);
    }
    catch (err) {
      fail(err);
    }
  }

  if (!printer) {
    return (
      <Panel>
        <EmptyState icon={<IconPresets />} title="No printers yet" description="Presets belong to a printer. Add a printer first, then save settings for it here." />
      </Panel>
    );
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <select
          className="control"
          style={{ width: "auto", minWidth: 220 }}
          aria-label="Printer"
          value={printer.id}
          onChange={(e) => {
            setPrinterId(Number(e.target.value));
            setEditing(null);
            setImported(null);
          }}
        >
          {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="spacer" />
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              void importFile(file);
          }}
        />
        <Button icon={<IconUpload />} loading={importing} onClick={() => fileRef.current?.click()}>Import</Button>
        {presets !== null && presets.length > 0 && <Button icon={<IconDownload />} onClick={() => void exportAll()}>Export</Button>}
        <Button variant="primary" icon={<IconPlus />} onClick={() => setEditing("new")} disabled={editing === "new"}>New preset</Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {imported && (
        <Notice tone={imported.imported.length > 0 ? "success" : "warning"}>
          {imported.imported.length === 0 ? "Nothing was imported." : `Imported ${imported.imported.length} preset${imported.imported.length === 1 ? "" : "s"}.`}
          {imported.skipped.length > 0 && (
            <ul className="notice-list">
              {imported.skipped.map(s => (
                <li key={`${s.name}:${s.reason}`}>
                  <b>{s.name}</b>
                  :
                  {" "}
                  {s.reason}
                </li>
              ))}
            </ul>
          )}
        </Notice>
      )}

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

      <div className="table-wrap">
        {presets === null
          ? <SkeletonRows />
          : presets.length === 0
            ? (
                <EmptyState
                  icon={<IconPresets />}
                  title={`No presets for ${printer.name}`}
                  description="A preset fixes a few settings, like double-sided and draft quality, so people pick a name instead of options."
                  action={<Button variant="primary" icon={<IconPlus />} onClick={() => setEditing("new")}>Create the first preset</Button>}
                />
              )
            : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Preset</th>
                      <th>Visibility</th>
                      <th>Settings</th>
                      <th>Status</th>
                      <th className="actions"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {presets.map(p => (
                      <tr key={p.id}>
                        <td>
                          <div className="primary">{p.name}</div>
                          {p.description && <div className="meta">{p.description}</div>}
                        </td>
                        <td><Badge plain>{p.scope === "global" ? "Everyone" : "Only me"}</Badge></td>
                        <td>
                          <div className="chips">
                            {Object.entries(p.options).map(([k, v]) => (
                              <span key={k} className="chip">
                                {optionLabel(fields, k)}
                                <b>{optionValueLabel(fields, k, v)}</b>
                              </span>
                            ))}
                            {Object.keys(p.options).length === 0 && <span className="meta">Printer defaults</span>}
                          </div>
                        </td>
                        <td>
                          {p.problems.length > 0
                            ? <Badge tone="danger">Needs attention</Badge>
                            : <Badge tone="success">Ready</Badge>}
                          {p.problems.length > 0 && <div className="meta danger-text">{p.problems.join("; ")}</div>}
                        </td>
                        <td className="actions">
                          {p.editable && (
                            <>
                              <Button size="sm" onClick={() => setEditing(p)}>Edit</Button>
                              <ConfirmButton size="sm" label="Delete" confirmLabel="Delete preset?" onConfirm={() => void remove(p)} />
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
      </div>
    </div>
  );
}
