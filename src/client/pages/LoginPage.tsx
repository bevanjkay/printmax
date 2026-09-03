import type { FormEvent } from "react";
import type { UserDto } from "../../shared/types.js";
import { useState } from "react";
import { api } from "../api.js";
import { useAsyncError } from "../util.js";

interface Props {
  needsSetup: boolean;
  onSignedIn: (user: UserDto) => void;
}

export function LoginPage({ needsSetup, onSignedIn }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { error, fail, clear } = useAsyncError();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    clear();
    try {
      const user = needsSetup ? await api.setup({ name, email, password }) : await api.login({ email, password });
      onSignedIn(user);
    }
    catch (err) {
      fail(err);
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <main className="narrow">
      <header>
        <h1>printmax</h1>
        <p className="muted">{needsSetup ? "No accounts exist yet. Create the first admin account." : "Sign in to print."}</p>
      </header>
      <form className="card" onSubmit={submit}>
        {needsSetup && (
          <label>
            Name
            <input required value={name} onChange={e => setName(e.target.value)} />
          </label>
        )}
        <label>
          Email
          <input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" required minLength={needsSetup ? 8 : undefined} autoComplete={needsSetup ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        <button disabled={busy}>{needsSetup ? "Create admin account" : "Sign in"}</button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
