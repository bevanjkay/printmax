import type { FormEvent } from "react";
import type { CapsChangeDto, DiscoveredPrinter, PrinterDto } from "../../shared/types.js";
import { useEffect, useState } from "react";
import { enumValue } from "../../shared/enums.js";
import { api } from "../api.js";
import { ConfirmButton } from "../components/ConfirmButton.js";
import { formatDate, useAsyncError } from "../util.js";

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
    <div className="card">
      <h3>Find printers on the network</h3>
      <p className="muted small">Uses DNS-SD (Bonjour). Only sees printers on the same network segment as the server; inside Docker that needs host networking.</p>
      <button type="button" onClick={scan} disabled={busy}>{busy ? "Scanning…" : "Scan"}</button>
      {error && <p className="error">{error}</p>}
      {found && found.length === 0 && <p className="muted">Nothing found.</p>}
      {found && found.length > 0 && (
        <table>
          <tbody>
            {found.map(p => (
              <tr key={`${p.name}@${p.host}`}>
                <td>
                  <strong>{p.name}</strong>
                  <br />
                  <span className="muted small">
                    {p.makeModel ?? "unknown model"}
                    {p.location ? ` · ${p.location}` : ""}
                    {" · "}
                    {p.duplex ? "duplex" : "simplex"}
                    {p.color ? " · colour" : ""}
                  </span>
                </td>
                <td className="small"><code>{p.uri ?? p.secureUri}</code></td>
                <td><button className="small" onClick={() => onPick(p)}>Use</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
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
    <div className="notice warn">
      <strong>Capabilities changed since the previous fetch.</strong>
      {" "}
      Presets that depend on removed values are flagged on the Presets page.
      {error && <p className="error">{error}</p>}
      {changes.map(c => (
        <div key={c.id} className="small">
          <div>{formatDate(c.fetchedAt)}</div>
          {c.added.length > 0 && (
            <div>
              Added:
              {" "}
              {c.added.join(", ")}
            </div>
          )}
          {c.removed.length > 0 && (
            <div>
              Removed:
              {" "}
              {c.removed.join(", ")}
            </div>
          )}
          {c.changed.length > 0 && (
            <div>
              Changed:
              {" "}
              {c.changed.join(", ")}
            </div>
          )}
          <button className="small" onClick={() => ack(c.id)}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}

/**
 * Admin overrides for capabilities the printer under-reports, such as a fitted finisher
 * that is missing from finishings-supported. Stored as raw IPP attributes on top of the discovered set.
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
        fail(new Error(`"${value}" is not a known ${attr} value`));
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

  return (
    <details>
      <summary>
        Capability overrides
        {Object.keys(overrides).length > 0 ? ` (${Object.keys(overrides).length})` : ""}
      </summary>
      <p className="muted small">Printers under-report optional hardware. Add a value the device really supports, such as a stapler in finishings-supported; it will appear in presets and the print form.</p>
      {Object.entries(overrides).map(([name, a]) => (
        <div key={name} className="small row">
          <code>{name}</code>
          <span>{a.values.map(v => typeof v === "object" ? JSON.stringify(v) : String(v)).join(", ")}</span>
          <button type="button" className="small danger" onClick={() => removeOverride(name)}>Reset</button>
        </div>
      ))}
      <form className="row" onSubmit={addValue}>
        <label>
          Attribute
          <select value={attr} onChange={e => setAttr(e.target.value)}>
            <option value="">Choose…</option>
            {listAttrs.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>
          Value to add
          <input value={value} onChange={e => setValue(e.target.value)} placeholder={attr.startsWith("finishings") ? "staple-top-left" : ""} />
        </label>
        <button className="small" disabled={!attr || !value}>Add</button>
      </form>
      {attr && (
        <p className="muted small">
          Currently:
          {" "}
          {(overrides[attr] ?? discovered[attr])?.values.map(v => String(v)).join(", ")}
        </p>
      )}
      {error && <p className="error">{error}</p>}
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
        {printer.hasCredentials ? " · authenticated" : ""}
      </p>
      {s.stateReasons.length > 0 && <p className="warn">{s.stateReasons.join(", ")}</p>}
      <Changes printer={printer} onChanged={onChanged} />
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
        <dt>Constraints</dt>
        <dd>{s.hasConstraints ? "published by printer" : "none published"}</dd>
        <dt>Job accounting</dt>
        <dd>{s.jobAccountIdSupported ? "job-account-id supported" : "not advertised"}</dd>
        <dt>Caps fetched</dt>
        <dd>{printer.capsFetchedAt ? formatDate(printer.capsFetchedAt) : "never"}</dd>
      </dl>
      <Overrides printer={printer} onChanged={onChanged} />
      <div className="row">
        <button disabled={busy} onClick={() => run(() => api.refreshPrinter(printer.id))}>Re-fetch capabilities</button>
        <ConfirmButton
          disabled={busy}
          className="danger"
          label="Remove"
          confirmLabel="Remove printer, its presets and job history?"
          onConfirm={() => void run(() => api.deletePrinter(printer.id))}
        />
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function AdminPrintersPage({ printers, onChanged }: Props) {
  const [prefill, setPrefill] = useState<DiscoveredPrinter | null>(null);
  return (
    <section className="grid">
      <div>
        {printers.length === 0 && <p className="muted">No printers yet.</p>}
        {printers.map(p => <PrinterCard key={p.id} printer={p} onChanged={onChanged} />)}
      </div>
      <div>
        <AddPrinter key={prefill ? `${prefill.name}@${prefill.host}` : "blank"} prefill={prefill} onAdded={onChanged} />
        <Discovery onPick={setPrefill} />
      </div>
    </section>
  );
}
