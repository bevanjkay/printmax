import type { FormEvent } from "react";
import type { CapsChangeDto, DiscoveredPrinter, FormField, PrinterDto } from "../../shared/types.js";
import { useEffect, useState } from "react";
import { keywordLabel, PRIMARY_ATTRIBUTES } from "../../shared/attributes.js";
import { enumValue } from "../../shared/enums.js";
import { api } from "../api.js";
import { ConfirmButton } from "../components/ConfirmButton.js";
import { IconChevron, IconPrinter, IconRefresh, IconSearch } from "../components/Icons.js";
import { Badge, Button, EmptyState, Field, Notice, Panel } from "../components/ui.js";
import { formatDate, stateTone, useAsyncError } from "../util.js";

type Caps = Record<string, { type: string; values: unknown[] }>;

interface Props {
  printers: PrinterDto[];
  onChanged: () => void;
}

/** Keyed on the discovered printer by the parent, so picking one resets the form with its details. */
function AddPrinter({ onAdded, prefill }: { onAdded: () => void; prefill: DiscoveredPrinter | null }) {
  const [uri, setUri] = useState(prefill?.uri ?? prefill?.secureUri ?? "");
  const [name, setName] = useState(prefill?.name ?? "");
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
    <form onSubmit={submit}>
      <Panel
        title="Add a printer"
        footer={<Button type="submit" variant="primary" loading={busy} disabled={!uri}>{busy ? "Asking the printer" : "Add printer"}</Button>}
      >
        <div className="panel-body">
          <Field label="IPP address" hint="Usually ipp://<printer-ip>/ipp/print. The printer is queried for its capabilities when you add it.">
            <input className="control" required placeholder="ipp://192.168.0.50/ipp/print" value={uri} onChange={e => setUri(e.target.value)} />
          </Field>
          <Field label="Name" hint="Optional. Defaults to the name the printer reports.">
            <input className="control" value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <div className="two-col">
            <Field label="Username" hint="Only if the printer requires sign-in for IPP.">
              <input className="control" autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} />
            </Field>
            <Field label="Password">
              <input className="control" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
            </Field>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </Panel>
    </form>
  );
}

function Discovery({ onPick }: { onPick: (p: DiscoveredPrinter) => void }) {
  const [found, setFound] = useState<DiscoveredPrinter[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { error, fail, clear } = useAsyncError();

  async function scan() {
    setBusy(true);
    clear();
    try {
      setFound(await api.discover());
    }
    catch (err) {
      fail(err);
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Find printers on the network" actions={<Button icon={<IconSearch />} loading={busy} onClick={scan}>{busy ? "Scanning" : "Scan"}</Button>}>
      <div className="panel-body">
        <p className="help">Looks for printers announcing themselves with Bonjour on this network. Inside Docker this needs host networking; adding by address always works.</p>
        {error && <Notice tone="error">{error}</Notice>}
        {found && found.length === 0 && <p className="help" style={{ marginTop: 10 }}>Nothing answered. The printer may be on another network, or not advertise itself.</p>}
      </div>
      {found && found.length > 0 && (
        <table className="table">
          <tbody>
            {found.map(p => (
              <tr key={`${p.name}@${p.host}`}>
                <td>
                  <div className="primary">{p.name}</div>
                  <div className="meta">
                    {p.makeModel ?? "unknown model"}
                    {p.location ? ` · ${p.location}` : ""}
                    {` · ${p.duplex ? "duplex" : "simplex"}`}
                    {p.color ? " · colour" : ""}
                  </div>
                </td>
                <td className="meta mono">{p.uri ?? p.secureUri}</td>
                <td className="actions"><Button size="sm" onClick={() => onPick(p)}>Use</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Changes({ printer, onChanged }: { printer: PrinterDto; onChanged: () => void }) {
  const [changes, setChanges] = useState<CapsChangeDto[]>([]);
  const { error, fail } = useAsyncError();

  useEffect(() => {
    api.listChanges(printer.id).then(setChanges).catch(fail);
  }, [printer.id, printer.pendingChanges, fail]);

  async function ack(id: number) {
    try {
      await api.ackChange(printer.id, id);
      onChanged();
    }
    catch (err) {
      fail(err);
    }
  }

  if (changes.length === 0)
    return null;
  return (
    <Notice tone="warning">
      <strong>The printer's capabilities changed since the previous fetch.</strong>
      {" "}
      Presets that rely on removed values are flagged on the Presets page.
      {error && <div className="danger-text">{error}</div>}
      {changes.map(c => (
        <div key={c.id} style={{ marginTop: 8 }}>
          <div className="xs muted">{formatDate(c.fetchedAt)}</div>
          {c.added.length > 0 && (
            <div>
              Added:
              {c.added.join(", ")}
            </div>
          )}
          {c.removed.length > 0 && (
            <div>
              Removed:
              {c.removed.join(", ")}
            </div>
          )}
          {c.changed.length > 0 && (
            <div>
              Changed:
              {c.changed.join(", ")}
            </div>
          )}
          <Button size="sm" onClick={() => ack(c.id)}>Dismiss</Button>
        </div>
      ))}
    </Notice>
  );
}

/**
 * Admin overrides for capabilities the printer under-reports, such as a fitted finisher missing from
 * finishings-supported. Stored as raw IPP attributes layered over the discovered set.
 */
function Overrides({ printer, onChanged }: { printer: PrinterDto; onChanged: () => void }) {
  const [discovered, setDiscovered] = useState<Caps>({});
  const [overrides, setOverrides] = useState<Caps>({});
  const [attr, setAttr] = useState("");
  const [value, setValue] = useState("");
  const { error, fail, clear } = useAsyncError();

  useEffect(() => {
    Promise.all([api.getCaps(printer.id, "discovered"), api.getCaps(printer.id, "overrides")])
      .then(([d, o]) => {
        setDiscovered(d);
        setOverrides(o);
      })
      .catch(fail);
  }, [printer.id, printer.overrideCount, fail]);

  const listAttrs = Object.entries(discovered)
    .filter(([k, a]) => k.endsWith("-supported") && ["keyword", "enum", "mimeMediaType", "integer"].includes(a.type))
    .map(([k]) => k)
    .sort();

  async function save(next: Caps) {
    clear();
    try {
      await api.setOverrides(printer.id, next);
      setOverrides(next);
      onChanged();
    }
    catch (err) {
      fail(err);
    }
  }

  function addValue(e: FormEvent) {
    e.preventDefault();
    const base = overrides[attr] ?? discovered[attr];
    if (!base || !value.trim())
      return;
    let v: unknown = value.trim();
    if (base.type === "enum") {
      v = enumValue(attr, value.trim());
      if (v === undefined) {
        fail(new Error(`"${value}" is not a known ${attr} value. Use a keyword such as staple-top-left or its number.`));
        return;
      }
    }
    else if (base.type === "integer") {
      v = Number(value);
    }
    if (base.values.includes(v))
      return;
    void save({ ...overrides, [attr]: { type: base.type, values: [...base.values, v] } });
    setValue("");
  }

  function removeOverride(name: string) {
    const next = { ...overrides };
    delete next[name];
    void save(next);
  }

  const listed = Object.entries(overrides).filter(([k]) => !k.endsWith("-default"));
  const count = listed.length;

  return (
    <details className="disclosure">
      <summary>
        <IconChevron className="icon chev" />
        Capability overrides
        {count > 0 && <Badge plain>{count}</Badge>}
      </summary>
      <div className="disclosure-body stack">
        <p className="help">Printers under-report optional hardware. Add a value the device really supports, such as a stapler in finishings-supported, and it becomes available in presets and the print form.</p>
        {listed.map(([name, a]) => (
          <div key={name} className="row between small">
            <span>
              <code>{name}</code>
              {" "}
              <span className="muted">{a.values.map(v => typeof v === "object" ? JSON.stringify(v) : String(v)).join(", ")}</span>
            </span>
            <Button size="sm" variant="danger" onClick={() => removeOverride(name)}>Reset to reported</Button>
          </div>
        ))}
        <form className="row" onSubmit={addValue}>
          <select className="control" style={{ width: "auto", minWidth: 200 }} aria-label="Attribute" value={attr} onChange={e => setAttr(e.target.value)}>
            <option value="">Choose an attribute</option>
            {listAttrs.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <input className="control" style={{ width: "auto", minWidth: 180 }} aria-label="Value to add" value={value} onChange={e => setValue(e.target.value)} placeholder={attr.startsWith("finishings") ? "staple-top-left" : "value"} />
          <Button type="submit" size="md" disabled={!attr || !value}>Add value</Button>
        </form>
        {attr && (
          <p className="xs muted">
            Currently reported:
            {" "}
            {(overrides[attr] ?? discovered[attr])?.values.map(v => String(v)).join(", ")}
          </p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </details>
  );
}

const labels = (xs: string[]) => xs.map(keywordLabel).join(", ") || "—";

const DEFAULTABLE = [...PRIMARY_ATTRIBUTES, "media-source", "output-bin", "orientation-requested"];

/** Per-printer defaults for the print form, e.g. A4 instead of the printer's own Letter. Stored as `<attribute>-default` overrides. */
function Defaults({ printer, onChanged }: { printer: PrinterDto; onChanged: () => void }) {
  const [fields, setFields] = useState<FormField[]>([]);
  const [overridden, setOverridden] = useState(() => new Set<string>());
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const { error, fail, clear } = useAsyncError();

  useEffect(() => {
    Promise.all([api.getForm(printer.id), api.getCaps(printer.id, "overrides")])
      .then(([f, o]) => {
        setFields(f);
        const names = new Set(Object.keys(o).filter(k => k.endsWith("-default")).map(k => k.slice(0, -"-default".length)));
        setOverridden(names);
        const initial: Record<string, string> = {};
        for (const field of f) {
          if (names.has(field.name) && field.default !== undefined && !Array.isArray(field.default))
            initial[field.name] = String(field.default);
        }
        setDraft(initial);
      })
      .catch(fail);
  }, [printer.id, printer.overrideCount, fail]);

  const editable = fields.filter(f => DEFAULTABLE.includes(f.name) && f.widget === "select" && (f.choices?.length ?? 0) > 1);
  if (editable.length === 0)
    return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    clear();
    setSaved(false);
    setBusy(true);
    try {
      const payload: Record<string, string> = {};
      for (const f of editable)
        payload[f.name] = draft[f.name] ?? "";
      await api.setDefaults(printer.id, payload);
      setSaved(true);
      onChanged();
    }
    catch (err) {
      fail(err);
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>
        <IconChevron className="icon chev" />
        Defaults for this printer
        {overridden.size > 0 && <Badge plain>{overridden.size}</Badge>}
      </summary>
      <form className="disclosure-body stack" onSubmit={save}>
        <p className="help">What the print form starts on. Presets still override these, and people can still change them per job.</p>
        <div className="form-grid">
          {editable.map(f => (
            <Field key={f.name} label={f.label}>
              <select
                className="control"
                value={draft[f.name] ?? ""}
                onChange={e => setDraft({ ...draft, [f.name]: e.target.value })}
              >
                <option value="">
                  {`Printer's own${!overridden.has(f.name) && f.default !== undefined ? ` (${f.choices?.find(c => String(c.value) === String(f.default))?.label ?? String(f.default)})` : ""}`}
                </option>
                {f.choices?.map(c => <option key={String(c.value)} value={String(c.value)}>{c.label}</option>)}
              </select>
            </Field>
          ))}
        </div>
        <div className="row">
          <Button type="submit" size="sm" variant="primary" loading={busy}>Save defaults</Button>
          {saved && <span className="success-text small">Saved.</span>}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </details>
  );
}

function PrinterCard({ printer, onChanged }: { printer: PrinterDto; onChanged: () => void }) {
  const { error, fail, clear } = useAsyncError();
  const [busy, setBusy] = useState(false);
  const s = printer.summary;

  async function run(action: () => Promise<unknown>) {
    clear();
    setBusy(true);
    try {
      await action();
      onChanged();
    }
    catch (err) {
      fail(err);
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={(
        <span className="row">
          {printer.name}
          <Badge tone={stateTone(s.state)}>{s.state}</Badge>
        </span>
      )}
      actions={(
        <>
          <Button size="sm" icon={<IconRefresh />} loading={busy} onClick={() => run(() => api.refreshPrinter(printer.id))}>Re-fetch</Button>
          <ConfirmButton size="sm" label="Remove" confirmLabel="Remove printer and its presets?" disabled={busy} onConfirm={() => void run(() => api.deletePrinter(printer.id))} />
        </>
      )}
    >
      <div className="panel-body stack">
        <div className="help">
          {printer.makeModel ?? "Unknown model"}
          {printer.location ? ` · ${printer.location}` : ""}
          {" · "}
          <code>{printer.uri}</code>
          {printer.hasCredentials ? " · signs in" : ""}
        </div>
        {s.stateReasons.length > 0 && <Notice tone="warning">{s.stateReasons.join(", ")}</Notice>}
        <Changes printer={printer} onChanged={onChanged} />
        <dl className="kv">
          <dt>Formats</dt>
          <dd>{s.documentFormats.join(", ") || "—"}</dd>
          <dt>Sides</dt>
          <dd>{labels(s.sides)}</dd>
          <dt>Colour</dt>
          <dd>{labels(s.colorModes)}</dd>
          <dt>Media</dt>
          <dd>{labels(s.media)}</dd>
          <dt>Trays</dt>
          <dd>{labels(s.mediaSources)}</dd>
          <dt>Finishing</dt>
          <dd>{labels(s.finishings)}</dd>
          <dt>Constraints</dt>
          <dd>{s.hasConstraints ? "Published by the printer" : "None published"}</dd>
          <dt>Accounting</dt>
          <dd>{s.jobAccountIdSupported ? "job-account-id supported" : "Not advertised"}</dd>
          <dt>Capabilities fetched</dt>
          <dd className="num">{printer.capsFetchedAt ? formatDate(printer.capsFetchedAt) : "never"}</dd>
        </dl>
        <Defaults printer={printer} onChanged={onChanged} />
        <Overrides printer={printer} onChanged={onChanged} />
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Panel>
  );
}

export function AdminPrintersPage({ printers, onChanged }: Props) {
  const [prefill, setPrefill] = useState<DiscoveredPrinter | null>(null);
  return (
    <div className="split">
      <div className="stack">
        {printers.length === 0 && (
          <Panel>
            <EmptyState icon={<IconPrinter />} title="No printers yet" description="Add one by its IPP address, or scan the network. printmax asks the printer what it can do and builds the options from the answer." />
          </Panel>
        )}
        {printers.map(p => <PrinterCard key={p.id} printer={p} onChanged={onChanged} />)}
      </div>
      <div className="stack">
        <AddPrinter key={prefill ? `${prefill.name}@${prefill.host}` : "blank"} prefill={prefill} onAdded={onChanged} />
        <Discovery onPick={setPrefill} />
      </div>
    </div>
  );
}
