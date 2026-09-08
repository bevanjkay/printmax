import type { FormEvent } from "react";
import type { UserDto } from "../../shared/types.js";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { ConfirmButton } from "../components/ConfirmButton.js";
import { Badge, Button, Field, Notice, Panel, SkeletonRows } from "../components/ui.js";
import { formatDate, useAsyncError } from "../util.js";

function ResetPassword({ user, onDone }: { user: UserDto; onDone: () => void }) {
  const [value, setValue] = useState("");
  const { error, fail, clear } = useAsyncError();

  async function submit(e: FormEvent) {
    e.preventDefault();
    clear();
    try {
      await api.setUserPassword(user.id, value);
      onDone();
    }
    catch (err) {
      fail(err);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <input className="control" type="password" autoComplete="new-password" placeholder="New password" aria-label={`New password for ${user.name}`} minLength={8} required autoFocus value={value} onChange={e => setValue(e.target.value)} />
      <Button type="submit" size="sm" variant="primary">Set</Button>
      <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      {error && <span className="danger-text xs">{error}</span>}
    </form>
  );
}

export function UsersPage({ me }: { me: UserDto }) {
  const [users, setUsers] = useState<UserDto[] | null>(null);
  const [resetting, setResetting] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [busy, setBusy] = useState(false);
  const { error, fail, clear } = useAsyncError();

  const refresh = useCallback(async () => {
    try {
      setUsers(await api.listUsers());
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
    setBusy(true);
    clear();
    try {
      await api.createUser({ name, email, password, role });
      setName("");
      setEmail("");
      setPassword("");
      setRole("user");
      await refresh();
    }
    catch (err) {
      fail(err);
    }
    finally {
      setBusy(false);
    }
  }

  async function changeRole(user: UserDto, role: "admin" | "user") {
    clear();
    try {
      await api.setUserRole(user.id, role);
      await refresh();
    }
    catch (err) {
      fail(err);
    }
  }

  async function remove(user: UserDto) {
    clear();
    try {
      await api.deleteUser(user.id);
      await refresh();
    }
    catch (err) {
      fail(err);
    }
  }

  return (
    <div className="split narrow-aside">
      <div className="stack">
        {error && <Notice tone="error">{error}</Notice>}
        <div className="table-wrap">
          {users === null
            ? <SkeletonRows />
            : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th className="actions"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td className="primary">
                          {u.name}
                          {u.id === me.id && <span className="meta"> (you)</span>}
                        </td>
                        <td className="meta email" title={`${u.email} · added ${formatDate(u.createdAt)}`}>{u.email}</td>
                        <td>
                          {u.id === me.id
                            ? <Badge tone="info" plain>Admin</Badge>
                            : (
                                <select className="control" style={{ width: "auto" }} aria-label={`Role of ${u.name}`} value={u.role} onChange={e => void changeRole(u, e.target.value as "admin" | "user")}>
                                  <option value="user">User</option>
                                  <option value="admin">Admin</option>
                                </select>
                              )}
                        </td>
                        <td className="actions">
                          {resetting === u.id
                            ? <ResetPassword user={u} onDone={() => setResetting(null)} />
                            : (
                                <>
                                  <Button size="sm" onClick={() => setResetting(u.id)}>Reset password</Button>
                                  {u.id !== me.id && <ConfirmButton size="sm" label="Delete" confirmLabel="Delete user?" onConfirm={() => void remove(u)} />}
                                </>
                              )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
        </div>
        <p className="help">Deleting a user removes their personal presets. Their job history stays.</p>
      </div>
      <form onSubmit={create}>
        <Panel title="Add a user" footer={<Button type="submit" variant="primary" loading={busy}>Create user</Button>}>
          <div className="panel-body">
            <Field label="Name">
              <input className="control" required value={name} onChange={e => setName(e.target.value)} />
            </Field>
            <Field label="Email">
              <input className="control" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" hint="At least 8 characters. They can change it under Account.">
              <input className="control" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
            </Field>
            <Field label="Role" hint="Admins manage printers, shared presets and users.">
              <select className="control" value={role} onChange={e => setRole(e.target.value as "admin" | "user")}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
          </div>
        </Panel>
      </form>
    </div>
  );
}
