import type { FormEvent } from "react";
import type { UserDto } from "../../shared/types.js";
import { useState } from "react";
import { api } from "../api.js";
import { Button, Field, Notice, Panel } from "../components/ui.js";
import { useAsyncError } from "../util.js";

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
      <form onSubmit={submit}>
        <Panel title="Change password" footer={<Button type="submit" variant="primary" loading={busy} disabled={!current || next.length < 8}>Change password</Button>}>
          <div className="panel-body">
            <Field label="Current password">
              <input className="control" type="password" required autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" hint="At least 8 characters. Other devices signed in as you are signed out.">
              <input className="control" type="password" required minLength={8} autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
            </Field>
            {done && <Notice tone="success">Password changed.</Notice>}
            {error && <Notice tone="error">{error}</Notice>}
          </div>
        </Panel>
      </form>
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
