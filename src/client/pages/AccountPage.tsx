import type { FormEvent } from "react";
import type { ApiTokenDto, CreatedApiTokenDto, UserDto } from "../../shared/types.js";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { ConfirmButton } from "../components/ConfirmButton.js";
import { Button, Field, Notice, Panel, SkeletonRows } from "../components/ui.js";
import { formatDate, useAsyncError } from "../util.js";

function NewToken({ token, onDismiss }: { token: CreatedApiTokenDto; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  // The clipboard API exists only in secure contexts; a LAN install on plain HTTP selects the text instead.
  const canCopy = typeof navigator.clipboard?.writeText === "function";

  return (
    <Notice tone="success">
      Copy
      {" "}
      <strong>{token.name}</strong>
      {" "}
      now. Only a hash of it is kept, so it can't be shown again.
      <div className="inline-form token-secret">
        <input className="control mono" readOnly aria-label={`Secret for ${token.name}`} value={token.secret} onFocus={e => e.currentTarget.select()} />
        {canCopy && <Button size="sm" onClick={() => void navigator.clipboard.writeText(token.secret).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</Button>}
        <Button size="sm" variant="ghost" onClick={onDismiss}>Done</Button>
      </div>
    </Notice>
  );
}

function ApiTokens() {
  const [tokens, setTokens] = useState<ApiTokenDto[] | null>(null);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedApiTokenDto | null>(null);
  const [busy, setBusy] = useState(false);
  const { error, fail, clear } = useAsyncError();

  const refresh = useCallback(async () => {
    try {
      setTokens(await api.listTokens());
    }
    catch (err) {
      fail(err);
    }
  }, [fail]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create(e: FormEvent) {
    e.preventDefault();
    clear();
    setBusy(true);
    try {
      setCreated(await api.createToken(name));
      setName("");
      await refresh();
    }
    catch (err) {
      fail(err);
    }
    finally {
      setBusy(false);
    }
  }

  async function revoke(token: ApiTokenDto) {
    clear();
    try {
      await api.deleteToken(token.id);
      if (created?.id === token.id)
        setCreated(null);
      await refresh();
    }
    catch (err) {
      fail(err);
    }
  }

  return (
    <Panel title="API tokens">
      <div className="panel-body stack">
        <p className="help">
          For scripts, automations and AI assistants. A token acts as you, with your access, until you revoke it. Send it as
          {" "}
          <code>Authorization: Bearer …</code>
        </p>
        {created && <NewToken key={created.id} token={created} onDismiss={() => setCreated(null)} />}
        {error && <Notice tone="error">{error}</Notice>}
        <form className="inline-form" onSubmit={create}>
          <input className="control" aria-label="Token name" placeholder="Name, such as n8n" maxLength={80} required value={name} onChange={e => setName(e.target.value)} />
          <Button type="submit" loading={busy} disabled={!name.trim()}>Create token</Button>
        </form>
      </div>
      {tokens === null
        ? <div className="panel-body"><SkeletonRows rows={2} /></div>
        : tokens.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th>Last used</th>
                <th className="actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id}>
                  <td className="primary">{t.name}</td>
                  <td className="meta">{formatDate(t.createdAt)}</td>
                  <td className="meta">{t.lastUsedAt ? formatDate(t.lastUsedAt) : "Never"}</td>
                  <td className="actions"><ConfirmButton size="sm" label="Revoke" confirmLabel="Revoke?" onConfirm={() => void revoke(t)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </Panel>
  );
}

export function AccountPage({ user }: { user: UserDto }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const { error, fail, clear } = useAsyncError();

  async function submit(e: FormEvent) {
    e.preventDefault();
    clear();
    setDone(false);
    setBusy(true);
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setDone(true);
    }
    catch (err) {
      fail(err);
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <div className="split narrow-aside">
      <div className="stack">
        <form onSubmit={submit}>
          <Panel title="Change password" footer={<Button type="submit" variant="primary" loading={busy} disabled={!current || next.length < 8}>Change password</Button>}>
            <div className="panel-body">
              <Field label="Current password">
                <input className="control" type="password" required autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
              </Field>
              <Field label="New password" hint="At least 8 characters. Other devices signed in as you are signed out; API tokens keep working.">
                <input className="control" type="password" required minLength={8} autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
              </Field>
              {done && <Notice tone="success">Password changed.</Notice>}
              {error && <Notice tone="error">{error}</Notice>}
            </div>
          </Panel>
        </form>
        <ApiTokens />
      </div>
      <Panel title="Signed in as">
        <div className="panel-body">
          <dl className="kv">
            <dt>Name</dt>
            <dd>{user.name}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Role</dt>
            <dd>{user.role === "admin" ? "Administrator" : "User"}</dd>
          </dl>
        </div>
      </Panel>
    </div>
  );
}
