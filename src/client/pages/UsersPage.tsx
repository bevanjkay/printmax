import type { FormEvent } from "react";
import type { UserDto } from "../../shared/types.js";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { ConfirmButton } from "../components/ConfirmButton.js";
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
    <form className="row" onSubmit={submit}>
      <input type="password" autoComplete="new-password" placeholder={`New password for ${user.name}`} minLength={8} required value={value} onChange={e => setValue(e.target.value)} />
      <button className="small">Set</button>
      <button type="button" className="small" onClick={onDone}>Cancel</button>
      {error && <span className="error small">{error}</span>}
    </form>
  );
}

export function UsersPage({ me }: { me: UserDto }) {
  const [users, setUsers] = useState<UserDto[]>([]);
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
    <section className="grid">
      <div>
        {error && <p className="error">{error}</p>}
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td className="small">{formatDate(u.createdAt)}</td>
                <td>
                  {resetting === u.id
                    ? <ResetPassword user={u} onDone={() => setResetting(null)} />
                    : (
                        <div className="row">
                          <button className="small" onClick={() => setResetting(u.id)}>Reset password</button>
                          {u.id !== me.id && <ConfirmButton className="small danger" label="Delete" confirmLabel="Delete user?" onConfirm={() => void remove(u)} />}
                        </div>
                      )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Deleting a user removes their personal presets; their job history stays.</p>
      </div>
      <form className="card" onSubmit={create}>
        <h3>Add user</h3>
        <label>
          Name
          <input required value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label>
          Email
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        <label>
          Role
          <select value={role} onChange={e => setRole(e.target.value as "admin" | "user")}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button disabled={busy}>{busy ? "Creating…" : "Create"}</button>
      </form>
    </section>
  );
}
