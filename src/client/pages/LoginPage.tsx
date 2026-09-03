import type { FormEvent } from "react";
import type { UserDto } from "../../shared/types.js";
import { useState } from "react";
import { api } from "../api.js";
import { BrandMark, Button, Field, Notice } from "../components/ui.js";
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
    <div className="auth">
      <form className="panel" onSubmit={submit}>
        <div className="panel-body">
          <div className="brand">
            <BrandMark />
            printmax
          </div>
          <h1>{needsSetup ? "Create the admin account" : "Sign in"}</h1>
          <p className="lede">{needsSetup ? "No accounts exist yet. This first account administers printers, presets and users." : "Use the account an administrator created for you."}</p>
          {needsSetup && (
            <Field label="Name">
              <input className="control" required autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
            </Field>
          )}
          <Field label="Email">
            <input className="control" type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" hint={needsSetup ? "At least 8 characters." : undefined}>
            <input className="control" type="password" required minLength={needsSetup ? 8 : undefined} autoComplete={needsSetup ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" variant="primary" size="lg" loading={busy} style={{ width: "100%", marginTop: 6 }}>
            {needsSetup ? "Create account" : "Sign in"}
          </Button>
        </div>
      </form>
    </div>
  );
}
