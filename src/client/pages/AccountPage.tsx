import type { FormEvent } from "react";
import type { UserDto } from "../../shared/types.js";
import { useState } from "react";
import { api } from "../api.js";
import { useAsyncError } from "../util.js";

export function AccountPage({ user }: { user: UserDto }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [done, setDone] = useState(false);
  const { error, fail, clear } = useAsyncError();

  async function submit(e: FormEvent) {
    e.preventDefault();
    clear();
    setDone(false);
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setDone(true);
    }
    catch (err) {
      fail(err);
    }
  }

  return (
    <form className="card narrow" onSubmit={submit}>
      <h3>Change password</h3>
      <p className="muted">
        Signed in as
        {" "}
        {user.name}
        {" "}
        (
        {user.email}
        ,
        {" "}
        {user.role}
        )
      </p>
      <label>
        Current password
        <input type="password" required autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
      </label>
      <label>
        New password
        <input type="password" required minLength={8} autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
      </label>
      <button>Change password</button>
      {done && <p className="ok">Password changed.</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}
