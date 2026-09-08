import type { FormEvent } from "react";
import type { FormField, PresetDto, PrinterDto, StoredJobDto, UserDto } from "../../shared/types.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { isPrimaryOption } from "../../shared/attributes.js";
import { api } from "../api.js";
import { ConfirmButton } from "../components/ConfirmButton.js";
import { IconLibrary, IconPlus, IconUpload } from "../components/Icons.js";
import { Badge, Button, Dropzone, EmptyState, Field, Notice, Panel, SkeletonRows } from "../components/ui.js";
import { formatDate, summariseOptions, useAsyncError } from "../util.js";

interface Props {
  user: UserDto;
  printers: PrinterDto[];
  onPrinted: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024)
    return `${n} B`;
  if (n < 1024 * 1024)
    return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface EditorProps {
  user: UserDto;
  printer: PrinterDto;
  presets: PresetDto[];
  entry: StoredJobDto | null;
  onSaved: () => void;
  onCancel: () => void;
}

/** New entries take a file; editing changes the name, preset and who can use it. */
function Editor({ user, printer, presets, entry, onSaved, onCancel }: EditorProps) {
  const [name, setName] = useState(entry?.name ?? "");
  const [presetId, setPresetId] = useState<number | null>(entry?.presetId ?? presets[0]?.id ?? null);
  const [scope, setScope] = useState<"global" | "user">(entry?.scope ?? (user.role === "admin" ? "global" : "user"));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const { error, fail, clear } = useAsyncError();

  async function submit(e: FormEvent) {
    e.preventDefault();
    clear();
    setBusy(true);
    try {
      if (entry)
        await api.updateStoredJob(entry.id, { name, presetId, scope, options: entry.options });
      else if (file)
        await api.addToLibrary({ printerId: printer.id, presetId, name, scope, file });
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
    <form onSubmit={submit}>
      <Panel
        title={entry ? `Edit ${entry.name}` : "Add to the library"}
        footer={(
          <>
            <span className="status">{entry ? `${entry.filename} · ${formatBytes(entry.byteSize)}` : "The document is kept until you delete it."}</span>
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!name || (!entry && !file)}>{entry ? "Save" : "Add to library"}</Button>
          </>
        )}
      >
        <div className="panel-body">
          {!entry && <Dropzone file={file} onFile={setFile} accept="application/pdf,image/png,image/jpeg" />}
          <div className="two-col">
            <Field label="Name">
              <input className="control" required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sunday bulletin" />
            </Field>
            <Field label="Print with" hint={presets.length === 0 ? "No presets for this printer; the printer's defaults apply." : "The preset as it is when you print, so later fixes to it flow through."}>
              <select className="control" value={presetId ?? ""} onChange={e => setPresetId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Printer defaults</option>
                {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
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
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </Panel>
    </form>
  );
}

function PrintCopies({ entry, onDone, onError }: { entry: StoredJobDto; onDone: () => void; onError: (err: unknown) => void }) {
  const [copies, setCopies] = useState(Number(entry.effectiveOptions.copies ?? 1) || 1);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.printStoredJob(entry.id, copies);
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
      <input className="control" type="number" inputMode="numeric" min={1} max={999} style={{ width: 76 }} aria-label={`Copies of ${entry.name}`} autoFocus value={copies} onChange={e => setCopies(Math.max(1, Number(e.target.value) || 1))} />
      <Button type="submit" size="sm" variant="primary" loading={busy}>{copies === 1 ? "Print 1 copy" : `Print ${copies} copies`}</Button>
      <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
    </form>
  );
}

export function LibraryPage({ user, printers, onPrinted }: Props) {
  const [printerId, setPrinterId] = useState<number | null>(null);
  const printer = printers.find(p => p.id === printerId) ?? printers[0];
  const [entries, setEntries] = useState<StoredJobDto[] | null>(null);
  const [presets, setPresets] = useState<PresetDto[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [editing, setEditing] = useState<StoredJobDto | null | "new">(null);
  const [printing, setPrinting] = useState<number | null>(null);
  const [replacing, setReplacing] = useState<number | null>(null);
  const [printed, setPrinted] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { error, fail, clear } = useAsyncError();

  const refresh = useCallback(async () => {
    if (!printer)
      return;
    try {
      const [e, p, f] = await Promise.all([api.listLibrary(printer.id), api.listPresets(printer.id), api.getForm(printer.id)]);
      setEntries(e);
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

  async function remove(entry: StoredJobDto) {
    clear();
    try {
      await api.deleteStoredJob(entry.id);
      await refresh();
    }
    catch (err) {
      fail(err);
    }
  }

  async function replaceFile(file: File) {
    if (replacing === null)
      return;
    clear();
    try {
      await api.replaceStoredFile(replacing, file);
      await refresh();
    }
    catch (err) {
      fail(err);
    }
    finally {
      setReplacing(null);
    }
  }

  if (!printer) {
    return (
      <Panel>
        <EmptyState icon={<IconLibrary />} title="No printers yet" description="Library entries belong to a printer. Add a printer first." />
      </Panel>
    );
  }

  const primaryNames = fields.filter(f => isPrimaryOption(f.name)).map(f => f.name);

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
            setPrinted(null);
          }}
        >
          {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="spacer" />
        <Button variant="primary" icon={<IconPlus />} onClick={() => setEditing("new")} disabled={editing === "new"}>Add document</Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            void replaceFile(file);
          else
            setReplacing(null);
        }}
      />
      {error && <Notice tone="error">{error}</Notice>}
      {printed && <Notice tone="success">{printed}</Notice>}

      {editing !== null && (
        <Editor
          key={editing === "new" ? "new" : editing.id}
          user={user}
          printer={printer}
          presets={presets}
          entry={editing === "new" ? null : editing}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="table-wrap">
        {entries === null
          ? <SkeletonRows />
          : entries.length === 0
            ? (
                <EmptyState
                  icon={<IconLibrary />}
                  title={`Nothing in the library for ${printer.name}`}
                  description="Keep the documents you print regularly here with the preset they use. Add one now, or use Keep on any job in the Jobs list."
                  action={<Button variant="primary" icon={<IconPlus />} onClick={() => setEditing("new")}>Add the first document</Button>}
                />
              )
            : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Prints as</th>
                      <th>Visibility</th>
                      <th>Last printed</th>
                      <th>Status</th>
                      <th className="actions"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(entry => (
                      <tr key={entry.id}>
                        <td>
                          <div className="primary">{entry.name}</div>
                          <div className="meta">{`${entry.filename} · ${formatBytes(entry.byteSize)}`}</div>
                        </td>
                        <td>
                          <div>{entry.presetName ?? (entry.presetId === null && Object.keys(entry.effectiveOptions).length === 0 ? "Printer defaults" : "Saved settings")}</div>
                          <div className="meta">{summariseOptions(fields, entry.effectiveOptions, primaryNames, { changesOnly: true })}</div>
                        </td>
                        <td><Badge plain>{entry.scope === "global" ? "Everyone" : "Only me"}</Badge></td>
                        <td className="meta num">
                          {entry.lastPrintedAt ? formatDate(entry.lastPrintedAt) : "Never"}
                          {entry.printCount > 0 && <div className="meta">{`${entry.printCount} ${entry.printCount === 1 ? "time" : "times"}`}</div>}
                        </td>
                        <td>
                          {entry.problems.length > 0 ? <Badge tone="danger">Needs attention</Badge> : <Badge tone="success">Ready</Badge>}
                          {entry.problems.length > 0 && <div className="meta danger-text">{entry.problems.join("; ")}</div>}
                        </td>
                        <td className="actions">
                          {printing === entry.id
                            ? (
                                <PrintCopies
                                  entry={entry}
                                  onDone={() => {
                                    setPrinting(null);
                                    setPrinted(`${entry.name} is queued. Watch it under Jobs.`);
                                    onPrinted();
                                    void refresh();
                                  }}
                                  onError={(err) => {
                                    setPrinting(null);
                                    fail(err);
                                  }}
                                />
                              )
                            : (
                                <>
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    disabled={entry.problems.length > 0}
                                    onClick={() => {
                                      clear();
                                      setPrinted(null);
                                      setPrinting(entry.id);
                                    }}
                                  >
                                    Print
                                  </Button>
                                  {entry.editable && (
                                    <>
                                      <Button size="sm" onClick={() => setEditing(entry)}>Edit</Button>
                                      <Button
                                        size="sm"
                                        icon={<IconUpload />}
                                        onClick={() => {
                                          setReplacing(entry.id);
                                          fileRef.current?.click();
                                        }}
                                      >
                                        Replace file
                                      </Button>
                                      <ConfirmButton size="sm" label="Delete" confirmLabel="Delete from library?" onConfirm={() => void remove(entry)} />
                                    </>
                                  )}
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
