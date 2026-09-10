import type { FormEvent } from "react";
import type { FormField, LibraryGroupDto, PresetDto, PrinterDto, StoredJobDto, UserDto } from "../../shared/types.js";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { isPrimaryOption } from "../../shared/attributes.js";
import { api } from "../api.js";
import { ConfirmButton } from "../components/ConfirmButton.js";
import { IconChevron, IconLibrary, IconPlus, IconSearch, IconUpload } from "../components/Icons.js";
import { Badge, Button, Dropzone, EmptyState, Field, Notice, NumberInput, Panel, SkeletonRows } from "../components/ui.js";
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

function documentCount(n: number): string {
  return n === 1 ? "1 document" : `${n} documents`;
}

interface GroupFieldProps {
  printerId: number;
  groups: LibraryGroupDto[];
  canManage: boolean;
  value: number | null;
  onChange: (groupId: number | null) => void;
  onCreated: () => Promise<void>;
  onError: (err: unknown) => void;
}

/** The list an admin keeps, with a way to add to it without leaving the document being filed. */
function GroupField({ printerId, groups, canManage, value, onChange, onCreated, onError }: GroupFieldProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const created = await api.createLibraryGroup(printerId, name.trim());
      await onCreated();
      onChange(created.id);
      setName("");
      setCreating(false);
    }
    catch (err) {
      onError(err);
    }
    finally {
      setBusy(false);
    }
  }

  if (creating) {
    return (
      <Field label="New group">
        <div className="inline-form">
          <input
            className="control"
            autoFocus
            value={name}
            placeholder="e.g. Sunday"
            aria-label="New group name"
            onChange={e => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter")
                return;
              e.preventDefault();
              if (name.trim() !== "")
                void create();
            }}
          />
          <Button size="sm" variant="primary" loading={busy} disabled={name.trim() === ""} onClick={() => void create()}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
        </div>
      </Field>
    );
  }

  return (
    <Field label="Group" hint={groups.length > 0 ? "Documents are listed under their group." : canManage ? "No groups yet. Add one to file documents under it." : "No groups yet; an admin keeps the list."}>
      <select
        className="control"
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value === "new")
            setCreating(true);
          else
            onChange(e.target.value === "" ? null : Number(e.target.value));
        }}
      >
        <option value="">No group</option>
        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        {canManage && <option value="new">+ Add new…</option>}
      </select>
    </Field>
  );
}

interface EditorProps {
  user: UserDto;
  printer: PrinterDto;
  presets: PresetDto[];
  groups: LibraryGroupDto[];
  entry: StoredJobDto | null;
  onGroupsChanged: () => Promise<void>;
  onSaved: (groupId: number | null) => void;
  onCancel: () => void;
}

/** New entries take a file; editing changes the name, group, preset and who can use it. */
function Editor({ user, printer, presets, groups, entry, onGroupsChanged, onSaved, onCancel }: EditorProps) {
  const [name, setName] = useState(entry?.name ?? "");
  const [groupId, setGroupId] = useState<number | null>(entry?.groupId ?? null);
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
        await api.updateStoredJob(entry.id, { name, presetId, groupId, scope, options: entry.options });
      else if (file)
        await api.addToLibrary({ printerId: printer.id, presetId, name, groupId, scope, file });
      onSaved(groupId);
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
          <div className="two-col">
            <GroupField
              printerId={printer.id}
              groups={groups}
              canManage={user.role === "admin"}
              value={groupId}
              onChange={setGroupId}
              onCreated={onGroupsChanged}
              onError={fail}
            />
            {user.role === "admin" && (
              <Field label="Who can use it">
                <select className="control" value={scope} onChange={e => setScope(e.target.value as "global" | "user")}>
                  <option value="global">Everyone</option>
                  <option value="user">Only me</option>
                </select>
              </Field>
            )}
          </div>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </Panel>
    </form>
  );
}

interface GroupManagerProps {
  printer: PrinterDto;
  groups: LibraryGroupDto[];
  onChanged: () => Promise<void>;
  onClose: () => void;
  onError: (err: unknown) => void;
}

/** Admins keep the list here: add, rename, order it, or drop a group and leave its documents behind. */
function GroupManager({ printer, groups, onChanged, onClose, onError }: GroupManagerProps) {
  const [adding, setAdding] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await onChanged();
    }
    catch (err) {
      onError(err);
    }
    finally {
      setBusy(false);
    }
  }

  function move(index: number, delta: number) {
    const ids = groups.map(g => g.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    void run(() => api.reorderLibraryGroups(printer.id, ids));
  }

  return (
    <Panel title="Groups" actions={<Button size="sm" onClick={onClose}>Done</Button>}>
      <div className="panel-body">
        <ul className="group-list">
          {groups.map((group, i) => (
            <li key={group.id}>
              {renaming?.id === group.id
                ? (
                    <form
                      className="inline-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        await run(() => api.renameLibraryGroup(group.id, renaming.name.trim()));
                        setRenaming(null);
                      }}
                    >
                      <input className="control" autoFocus aria-label={`Rename ${group.name}`} value={renaming.name} onChange={e => setRenaming({ id: group.id, name: e.target.value })} />
                      <Button type="submit" size="sm" variant="primary" loading={busy} disabled={renaming.name.trim() === ""}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                    </form>
                  )
                : (
                    <>
                      <span className="primary">{group.name}</span>
                      <span className="meta">{documentCount(group.documentCount)}</span>
                      <div className="spacer" />
                      <Button size="sm" className="btn-icon" aria-label={`Move ${group.name} up`} disabled={busy || i === 0} icon={<IconChevron className="icon chev-up" />} onClick={() => move(i, -1)} />
                      <Button size="sm" className="btn-icon" aria-label={`Move ${group.name} down`} disabled={busy || i === groups.length - 1} icon={<IconChevron className="icon chev-down" />} onClick={() => move(i, 1)} />
                      <Button size="sm" onClick={() => setRenaming({ id: group.id, name: group.name })}>Rename</Button>
                      <ConfirmButton
                        size="sm"
                        label="Delete"
                        confirmLabel={group.documentCount > 0 ? `Delete? ${documentCount(group.documentCount)} become ungrouped` : "Delete group?"}
                        onConfirm={() => void run(() => api.deleteLibraryGroup(group.id))}
                      />
                    </>
                  )}
            </li>
          ))}
          {groups.length === 0 && <li className="meta">No groups yet. Documents stay in one flat list until you add one.</li>}
        </ul>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            await run(() => api.createLibraryGroup(printer.id, adding.trim()));
            setAdding("");
          }}
        >
          <input className="control" aria-label="New group name" placeholder="e.g. Sunday" value={adding} onChange={e => setAdding(e.target.value)} />
          <Button type="submit" size="sm" variant="primary" icon={<IconPlus />} loading={busy} disabled={adding.trim() === ""}>Add group</Button>
        </form>
      </div>
    </Panel>
  );
}

function PrintCopies({ entry, onDone, onCancel, onError }: { entry: StoredJobDto; onDone: () => void; onCancel: () => void; onError: (err: unknown) => void }) {
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
      <NumberInput min={1} max={999} style={{ width: 76 }} aria-label={`Copies of ${entry.name}`} autoFocus value={copies} onChange={setCopies} />
      <Button type="submit" size="sm" variant="primary" loading={busy}>{copies === 1 ? "Print 1 copy" : `Print ${copies} copies`}</Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
    </form>
  );
}

interface Section {
  key: string;
  name: string;
  items: StoredJobDto[];
}

function sectionKey(groupId: number | null): string {
  return groupId === null ? "ungrouped" : `group-${groupId}`;
}

/**
 * One section per group, in the order the admin put them in, with the ungrouped documents last.
 * An empty group still shows so it can be filed into; a search hides whatever it did not match.
 */
function sections(groups: LibraryGroupDto[], entries: StoredJobDto[], searching: boolean): Section[] {
  const bucket = new Map<number | null, StoredJobDto[]>();
  for (const entry of entries) {
    const items = bucket.get(entry.groupId);
    if (items)
      items.push(entry);
    else
      bucket.set(entry.groupId, [entry]);
  }
  const filed = groups.map(g => ({ key: sectionKey(g.id), name: g.name, items: bucket.get(g.id) ?? [] }));
  const loose = { key: sectionKey(null), name: "Ungrouped", items: bucket.get(null) ?? [] };
  return [
    ...(searching ? filed.filter(s => s.items.length > 0) : filed),
    ...(loose.items.length > 0 ? [loose] : []),
  ];
}

function matches(entry: StoredJobDto, query: string): boolean {
  return [entry.name, entry.filename, entry.group, entry.presetName].some(v => v?.toLowerCase().includes(query));
}

export function LibraryPage({ user, printers, onPrinted }: Props) {
  const [printerId, setPrinterId] = useState<number | null>(null);
  const printer = printers.find(p => p.id === printerId) ?? printers[0];
  const [entries, setEntries] = useState<StoredJobDto[] | null>(null);
  const [groups, setGroups] = useState<LibraryGroupDto[]>([]);
  const [presets, setPresets] = useState<PresetDto[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [editing, setEditing] = useState<StoredJobDto | null | "new">(null);
  const [managing, setManaging] = useState(false);
  const [printing, setPrinting] = useState<number | null>(null);
  const [replacing, setReplacing] = useState<number | null>(null);
  const [printed, setPrinted] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const { error, fail, clear } = useAsyncError();

  const refresh = useCallback(async () => {
    if (!printer)
      return;
    try {
      const [e, g, p, f] = await Promise.all([api.listLibrary(printer.id), api.listLibraryGroups(printer.id), api.listPresets(printer.id), api.getForm(printer.id)]);
      setEntries(e);
      setGroups(g);
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
  const trimmed = query.trim().toLowerCase();
  const searching = trimmed !== "";
  const shown = (entries ?? []).filter(e => !searching || matches(e, trimmed));
  const grouped = sections(groups, shown, searching);
  // Sections start closed, and a search opens what it found until the reader says otherwise.
  const isOpen = (section: Section) => open[section.key] ?? searching;
  const allOpen = grouped.every(isOpen);

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
            setManaging(false);
            setPrinted(null);
            setOpen({});
          }}
        >
          {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="search">
          <IconSearch className="icon" />
          <input className="control" type="search" aria-label="Search the library" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        {groups.length > 0 && (
          <Button variant="ghost" onClick={() => setOpen(Object.fromEntries(grouped.map(s => [s.key, !allOpen])))}>
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        )}
        <div className="spacer" />
        {user.role === "admin" && <Button onClick={() => setManaging(m => !m)}>Groups</Button>}
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

      {managing && (
        <GroupManager
          printer={printer}
          groups={groups}
          onChanged={refresh}
          onClose={() => setManaging(false)}
          onError={fail}
        />
      )}

      {editing !== null && (
        <Editor
          key={editing === "new" ? "new" : editing.id}
          user={user}
          printer={printer}
          presets={presets}
          groups={groups}
          entry={editing === "new" ? null : editing}
          onGroupsChanged={refresh}
          onSaved={(groupId) => {
            setEditing(null);
            setOpen(o => ({ ...o, [sectionKey(groupId)]: true }));
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
            : shown.length === 0
              ? (
                  <EmptyState
                    icon={<IconSearch />}
                    title={`Nothing matches “${query.trim()}”`}
                    description="Search covers the document's name, its file, its group and the preset it prints with."
                    action={<Button onClick={() => setQuery("")}>Clear search</Button>}
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
                      {grouped.map(section => (
                        <Fragment key={section.key}>
                          {groups.length > 0 && (
                            <tr className="group-row">
                              <th colSpan={6} scope="colgroup">
                                <button
                                  type="button"
                                  className="group-toggle"
                                  aria-expanded={isOpen(section)}
                                  onClick={() => setOpen(o => ({ ...o, [section.key]: !isOpen(section) }))}
                                >
                                  <IconChevron className="icon chev" />
                                  {section.name}
                                  <span className="count">{section.items.length}</span>
                                </button>
                              </th>
                            </tr>
                          )}
                          {isOpen(section) && section.items.length === 0 && (
                            <tr><td className="meta" colSpan={6}>Nothing filed here yet.</td></tr>
                          )}
                          {(groups.length === 0 || isOpen(section)) && section.items.map(entry => (
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
                                        onCancel={() => setPrinting(null)}
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
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                )}
      </div>
    </div>
  );
}
